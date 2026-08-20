# One image, one origin: the Angular bundle is built here and published into the API's wwwroot, so the
# deployed app serves its own frontend. That is what removes CORS from the picture entirely and lets
# SignalR hold a real WebSocket instead of degrading to long polling behind a proxy.
#
# Build:  docker build -t instagraph .
# Run:    docker run -p 8080:8080 -e ConnectionStrings__DefaultConnection="..." instagraph

# ----------------------------------------------------------------- frontend
FROM node:20-alpine AS frontend

WORKDIR /src/frontend

# package files first: this layer only re-runs when dependencies actually change, so ordinary source
# edits reuse the cached npm install rather than paying for it on every build.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ------------------------------------------------------------------ backend
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS backend

WORKDIR /src

COPY backend/InstaGraph.Api/InstaGraph.Api.csproj backend/InstaGraph.Api/
RUN dotnet restore backend/InstaGraph.Api/InstaGraph.Api.csproj

COPY backend/ backend/

# appsettings.json is gitignored, so it is not in the build context. The example is the same file with
# the two secrets blanked, and it carries everything the app genuinely needs to boot — the feed and
# graph weights, the upload limits. The real secrets arrive as environment variables at run time
# (ConnectionStrings__DefaultConnection, Jwt__SecretKey, Email__Password), which override this file.
RUN cp backend/InstaGraph.Api/appsettings.example.json backend/InstaGraph.Api/appsettings.json

# The csproj's PublishAngular target looks for the bundle at this path relative to the project, so the
# frontend output is placed where an ordinary `dotnet publish` on a dev machine would have found it.
COPY --from=frontend /src/frontend/dist/instagraph-ui/browser/ frontend/dist/instagraph-ui/browser/

RUN dotnet publish backend/InstaGraph.Api/InstaGraph.Api.csproj -c Release -o /app

# ------------------------------------------------------------------ runtime
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime

WORKDIR /app
COPY --from=backend /app ./

# Uploaded photos are written here at runtime. On a container host this path wants a mounted volume —
# without one, every restart loses the images while their rows stay in the database.
RUN mkdir -p /app/wwwroot/uploads

EXPOSE 8080

# Railway, Render and Fly inject the port to listen on as $PORT, and it is not the same number every
# deploy. ASP.NET does not read that variable, so binding it has to happen here — a container that
# listens on a fixed 8080 while the platform routes to something else fails its health check and the
# deploy is marked failed with the app running perfectly inside.
#
# Shell form on purpose: $PORT has to expand at container start, not at image build. 0.0.0.0 rather
# than localhost, or the process is unreachable from outside its own container.
ENTRYPOINT ["sh", "-c", "dotnet InstaGraph.Api.dll --urls http://0.0.0.0:${PORT:-8080}"]
