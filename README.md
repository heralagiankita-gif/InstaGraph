# InstaGraph

A photo-sharing app — a ranked feed, **carousels** of up to ten photos, **video posts and a vertical
Reels feed**, 24-hour **stories** with a full-screen player and **highlights** kept on a profile,
profiles, follows, likes, threaded comments, saves sorted into **collections**, **people tagged in
photos**, an **archive**, pinned posts, verified badges, mentions, blocking, muting, private accounts,
explore, hashtags, notifications, filters, real uploads, and **live direct messages** with requests,
reactions, replies, unsend, read receipts, typing indicators, presence, notes, close friends,
favourites and a full settings screen. It looks and behaves like Instagram.

**It is genuinely real time.** One WebSocket carries messages, typing, read receipts, presence,
notifications, new posts and new stories the instant they happen — no screen in the app polls for them.
Nothing is *only* realtime, though: every stream has an HTTP endpoint behind it, so a browser that
cannot open a socket ends up slower and never wrong.

Underneath, follows are a directed graph, and the feed, "Suggested for you", the story row,
"Followed by … and 3 others", Explore, *which folder of the inbox a message lands in* and *who your note
reaches* are all questions asked of it. None of that shows on screen: there is no lab, no algorithm
names, no complexity counters. It is a social app that happens to be built on a graph.

Messaging then adds a **second** graph over the first — undirected, weighted by traffic, and able to
exist between two accounts that follow each other in neither direction. The two are wired together:
every message you send adds to the weight on whatever follow edges exist, and that weight is the
affinity term in your feed.

**The database starts empty.** There is no demo data — the first account you create is genuinely the
first node, and the app is built to be honest about that: an account with no follows has an empty feed
and a get-started screen, not a borrowed one.

| Layer | Technology |
|---|---|
| Backend | .NET 8 Web API, EF Core 8, SQL Server, JWT, SignalR, Swagger |
| Frontend | Angular 22 (standalone components, signals), @microsoft/signalr, hand-written CSS |
| Graph | In-memory adjacency lists, algorithms written out longhand — no graph library |
| Media | Real multipart uploads to `wwwroot/uploads` — photos and video alike; filters baked in with canvas, and a clip's poster frame grabbed from the video in the browser |

```
InstaGraph
├── backend\
│   ├── InstaGraph.sln              open this in Visual Studio
│   └── InstaGraph.Api\
│       ├── Graph\                  ← SocialGraph, the suggestion engine, the snapshot provider
│       ├── Realtime\               ← the hub, and the one way anything pushes to a browser
│       ├── Services\               ← feed ranking, messaging, stories, graph insights, posts, users
│       └── wwwroot\uploads\        ← every uploaded photo and clip
└── frontend\                       open this folder in VS Code
    └── src\app\
        ├── features\               home, explore, reels, discover, create, profile, post, activity,
        │                           archive, network, tag, auth, messages, settings, stories
        ├── shared\                 post media, post card, grid, story tray, composer, sheets
        └── layout\                 the sidebar shell
```

---

## 1. Running it

**Prerequisites** — .NET SDK 8 or later, SQL Server on `localhost`, Node 20+.

```bash
cd backend/InstaGraph.Api
cp appsettings.example.json appsettings.json
dotnet run
```

`appsettings.json` is gitignored because it holds the JWT signing key and the SMTP password, so a fresh
clone has to make its own from the example. The defaults in it run the app as-is.

Starts on **http://localhost:5120** and creates the database if it is not there. Swagger is at
**http://localhost:5120/swagger**.

If SQL Server is not on `localhost`, edit `ConnectionStrings:DefaultConnection` in
`backend/InstaGraph.Api/appsettings.json` first.

```bash
cd frontend
npm start
```

Runs at **http://localhost:4200**. CORS already allows 4200 and 4300.

Then **create an account** — the app opens on the sign-up screen and works from there.

### Signing up, and the confirmation code

Sign-up is three screens, not one: your details, the six-digit code emailed to you, then the login
screen with your new username already filled in.

The order is the point. The address is confirmed **before** the `Users` row is written, so an
unconfirmed address never becomes an account and "one account per email" is a fact about the database
rather than a promise in a form. The code is stored only as a hash, expires in ten minutes, allows five
wrong guesses, and the token it produces is single-use.

**Out of the box no mail is sent.** `Email:SmtpHost` in `appsettings.json` is empty, so the API writes
the whole message to its own log — and says so on the confirmation screen, which shows the code with a
*Fill it in* button rather than leaving you waiting on an inbox that will never receive anything. That
only ever happens on a Development build with no SMTP configured; a deployed API never returns the code.

To send for real, fill in the `Email` section. With a Gmail account that is:

```jsonc
"Email": {
  "SmtpHost": "smtp.gmail.com",
  "SmtpPort": 587,
  "UseSsl": true,
  "Username": "you@gmail.com",
  "Password": "<a Google App Password, not your account password>",
  "FromAddress": "you@gmail.com",
  "FromName": "InstaGraph"
}
```

Register also enforces what the form promises: a real date of birth with a minimum age of 13, a
password of at least eight characters mixing two character classes and containing neither the username
nor anything off the common-password list, and a username that is neither taken nor one of the app's
own route names.

That password rule is written once, in `Common/PasswordPolicy.cs`, and mirrored once in
`shared/password-strength.ts` for the meter. Three screens ask for a password now — signing up,
resetting a forgotten one and changing one from settings — and a rule copied per screen is a rule that
ends up disagreeing with the server on one of them.

### Forgetting it, and changing it

**Forgotten your password?** on the login screen runs the same three steps as sign-up, pointed at the
other end of an account's life: who you are, the six digits, the new password. It shares the table, the
ten-minute expiry, the five wrong guesses and the resend cooldown with sign-up — and shares no *row*
with it, because a `Purpose` column keeps a reset code from being redeemed as a sign-up and back.

The first screen answers the same way whether or not the account exists. It has to: an unauthenticated
form that confirms which usernames are real hands straight back what login refuses to say, and it is the
easier of the two to find. What comes back instead is the address masked — `an•••a@g•••.com` — which is
enough to recognise your own inbox and useless for learning anybody else's.

**Settings → Password and security → Change password** is the other route to the same place, and needs
the current password rather than an email.

Both of them **end every other session**. That is the part worth having: a JWT is a signed claim about
the past, so nothing that happens afterwards reaches back to invalidate one, and a password change that
left an eight-hour token running in somebody else's browser would not be a password change at all. So
each token carries the moment it was issued, each account remembers when its password last moved, and a
token from before that moment is refused. The browser that asked for the change is handed a replacement
in the same response, so it is the only one still signed in. It costs a dictionary lookup per request
rather than a query — see `Services/SessionRevocations.cs`.

**Signing in is also rate-limited.** Five wrong passwords and the app stops checking them for a minute;
keep going and that becomes five minutes, then fifteen, then an hour. Both the account and the calling
address are counted, because either alone has a hole in it — count only the account and one machine can
work through a list of them unimpeded; count only the address and a botnet spreads the guessing at one
account across many. BCrypt makes each guess slow, which is not the same as making them few.

### Starting over

To wipe everything and begin from nothing again:

```bash
cd backend/InstaGraph.Api
dotnet ef database drop --force
rm wwwroot/uploads/*
dotnet run
```

Dropping the database is the honest version and the one to prefer: it takes the schema with it, so the
next `dotnet run` rebuilds from the migrations and nothing survives by accident. If the database has to
stay in place — because something else is holding a connection to it — deleting every row instead works,
provided the foreign keys are disabled around it and the identity columns are reseeded afterwards.
Reseeding is the part that is easy to forget and the part that shows: without it the first account on a
"fresh" database is user 47, which rather gives the game away.

Either way, empty the `wwwroot/uploads` folder too. The rows that pointed at those files are gone, so
what is left is bytes nothing can reach.

---

## 2. A five-minute demo path

Because there is no seed data, the order below is what makes the app show what it can do.

1. **Sign up** as your first account. The feed is empty and shows a three-step get-started card — that
   is what an isolated node looks like.
2. **Create a post.** Pick a photo, run through the **filter strip**, add a caption with `#tags`,
   share it.
3. **Sign up a second account** in a private window. Its feed is empty too.
4. **Search** for the first account and **follow** it. The feed fills. Post a **story** from the first
   account and a **gradient ring** appears at the top of the second one — tap it for the full-screen
   player, with segmented progress bars, tap-to-advance and hold-to-pause.
5. **Like, comment, save.** The first account's **Notifications** shows all three arrive — except the
   save, which is private and notifies nobody.
6. **Sign up a third account** and have it follow the second. Now go back to the first account's
   **Suggested for you**: the third account appears, labelled *"Followed by …"* — that is a two-hop
   traversal, and it did not exist a moment ago. Press the **ⓘ** on that row to see which signals
   produced it and what each one contributed.
7. Open **Discover** in the sidebar and move through the tabs. The same graph answers a different
   question in each one; *Follows you* and *Popular in your circle* rarely contain the same accounts.
8. Open **Network**. Your neighbourhood is drawn from the edge set alone — size is PageRank, an arrowhead
   is a one-way follow, a thick line means it runs both ways, and colour is whichever of community,
   relationship or distance you pick. Hover a node to isolate its edges, click one to open the profile.

   The depth control carries the count each hop *adds*, and the ring for an empty hop is still drawn and
   labelled. That matters: if everyone you follow only follows you back, your neighbourhood is a star,
   nothing exists at two hops, and 1/2/3 hops legitimately draw the same picture. A depth button reading
   **+0** against a ring marked *empty* is the app telling you that, rather than looking broken.
9. Open somebody's **profile** and look under the mutuals line: *"2nd degree · through …"* with the chain
   spelled out. That is a breadth-first search with its parent pointers walked back.
10. **Toggle the theme** at the bottom of the sidebar — light, dark, follow the system.
11. Open a profile and the **SAVED** tab; set an account **private** and watch a follow become a request
    that has to be confirmed under Notifications.
12. **Mute** the second account from the ⋯ menu on one of its posts — the posts leave your feed, but the
    profile still says Following and the other side is never told. Unmute and they come back.
13. **Block** the third account. Then check **Suggested for you**: it is gone, even though the account
    you both follow is still sitting there as a route to it. It also disappears from the network drawing
    and from the connection line on any profile. Unblock and note that nobody was re-followed.
14. On a post, **reply** to a comment and **like** a comment; write `@handle` in a caption and watch it
    turn into a link and land in that account's Notifications.

### The messaging half of the demo

15. From the **third** account — the one nobody follows back — open the first account's profile and press
    **Message**. Send something. Now sign in as the first account: it is **not** in the inbox. It is under
    **Requests**, with a header explaining who this is *from the graph* — how many mutuals, how many hops
    away, whether they follow you. Press **Accept** and it moves into the inbox; the sender was never told
    it had been sitting there, and reading a request deliberately does not put "Seen" under it.
16. Message the **second** account instead — the one that follows you. It lands straight in the inbox,
    no request, because the edge back already exists. That single test is the entire mechanism.
17. In the thread: **double-click** a bubble to react, hover one for **reply** and **unsend**, send a
    **photo**, and watch **typing…** and the green **Active now** dot appear from the other window.
    Unsend a message somebody replied to — the row survives, emptied, so the reply still resolves.
18. Press the **paper plane** on any post and share it into a chat. The list of people is ordered by the
    interaction weight already on the edge between you, not alphabetically.
19. Write a **note** — the bubble above the inbox. Only accounts you follow *who follow you back* can see
    it. Tick **close friends only** and it narrows again, to a list you name yourself. Three audiences,
    one edge set, none of them stored as a list of recipients.
20. Open **Settings** → **Messages** and set it to **No one**, then try to open a new chat from another
    account: refused. Existing threads keep working. Put a word in **Hidden Words** and have a stranger
    send a request containing it — it goes straight to **Spam**, and they are not told which word.
21. Settings → **Favourites**, add the second account, and watch their photos climb your feed. It is the
    only signal in the ranking you stated out loud rather than the graph inferred.

### The parts that are worth two windows open at once

Put two accounts side by side, signed in to different browsers. Nothing below needs a refresh anywhere.

22. **Type** in a chat from one window. The other shows *typing…* — on the thread and on the inbox row —
    and it fades on its own a few seconds after you stop.
23. **Send.** The bubble appears in the other window immediately, and the badge in its sidebar moves. Open
    the thread there and **Seen** appears back in the first window as it happens.
24. **React** to a message, then **unsend** one. Both change in place in the other window; the unsent row
    stays, emptied, so a reply pointing at it still resolves.
25. **Like** the other account’s photo. A toast slides in — *“nila liked your photo”* — and the heart
    badge moves, without that screen having asked for anything.
26. **Post a story.** The ring appears in the other window on its own. Watch it and, back in the first,
    the eye count on your own story has moved. Press it for the viewers list — visible to you and to
    nobody else.
27. **Post a photo.** The other window grows a **“New post”** pill at the top of the feed rather than
    shuffling itself while somebody is reading it: where a post belongs is a question only the ranking
    can answer, so the socket offers a refresh instead of guessing at a position.
28. **Close one window.** The green dot in the other goes out within a second or two, and the header
    changes to *Active just now*. Turn **activity status** off in Settings and it stops working in both
    directions at once — you stop being visible, and you stop seeing anybody else.
29. **Kill the API** while a chat is open. A dark **“Reconnecting”** bar appears at the top; the app keeps
    working on plain HTTP. Start it again and the bar goes, and every open list refetches itself, because
    whatever happened during the gap was never delivered and never will be.

---

## 3. What you can do

| Screen | |
|---|---|
| **Home** | Story rings, ranked feed, swipeable carousels, clips that play as you reach them, double-tap to like, inline comments, save, "Suggested for you" posts mixed in, suggestions rail with a per-row score breakdown |
| **Search** | Slide-over panel, accounts and hashtags together, debounced |
| **Discover** | People finder split by the signal that produced each row — follows you, friends of friends, popular in your circle, extended network, same community |
| **Network** | Your neighbourhood drawn as a live force-directed graph: colour is community, size is PageRank, doubled lines are reciprocal follows. Reach, reciprocity, clustering and influence alongside it |
| **Explore** | Grid of photos from accounts you do not follow, trending tags across the top |
| **Create** | Drag or pick up to ten photos and clips, reorder them, filter each one, tag people by tapping the photo, caption with live tag echo, location, and per-post switches for commenting and counts. Video posts as a reel |
| **Reels** | A full-height vertical feed of every clip in the app, snap-scrolled, one playing at a time, with likes, comments, saves, shares and a play count |
| **Profile** | POSTS, TAGGED and SAVED tabs, story highlights under the bio, pinned posts first, follow / unfollow, block, mute, remove a follower, cancel a sent request, followers and following lists, edit name, bio and privacy, change profile photo, blocked-accounts list |
| **Post** | Full-size photo or carousel, tap to reveal who is tagged, threaded comments with replies and comment likes, edit your own caption and switches, like, save, file into a collection, pin, archive, delete |
| **Archive** | Posts you have put away, restorable in one tap, and every story you have ever posted — which is where highlights are built from |
| **Activity** | Likes, comments, replies, comment likes, mentions, photo tags and follows, with follow requests to confirm or delete |
| **Messages** | Inbox, Requests and Spam; one-to-one and group threads; text, photos, shared posts and shared profiles; replies, emoji reactions, unsend, read receipts, typing indicators, presence; mute, pin and delete; a new-message picker ordered by the graph |
| **Stories** | 24-hour photos with a full-screen player: segmented progress bars, tap left and right, hold to pause, close-friends-only, a viewers list only the author sees, and replies that arrive as ordinary direct messages |
| **Notes** | A line of text above the inbox for a day, reaching the accounts you follow who follow you back — or only your close friends |
| **Settings** | Account privacy, close friends, favourites, blocked, muted, who can message you, who can comment, hidden words, activity status, read receipts, like counts, **change password**, appearance and vibe, and your activity counted |
| **Getting back in** | Forgotten-password reset by emailed code, with the address masked and the answer identical whether or not the account exists. Changing a password by either route signs out every other browser |
| **Tag** | Everything posted under one hashtag |
| **Theme** | Light, dark, or follow the operating system — remembered between visits |
| **Vibes** | Seven colour schemes — Aurora, Sunset, Y2K, Matcha, Cyber, Bubblegum and Classic — each swapping the accent, the story rings, the wordmark gradient and the aura behind the page. Independent of light and dark, remembered between visits, and reachable from More, Settings, or the `v` key |
| **Profile card** | Your profile as a gradient card in the current vibe, with a link and three counts, downloadable as a PNG |
| **Installed** | A real PWA: manifest, generated icons, a network-first service worker, standalone display, and safe-area insets so the bars clear a notch and a home indicator. Add to Home Screen and it opens without browser chrome |

`#hashtags` and `@mentions` are parsed out of every caption and comment: tags link to their page,
mentions link to the profile and notify the person named.

Photos and video are genuine uploads — JPG, PNG, GIF or WEBP up to 8 MB, MP4, WEBM or MOV up to 60 MB,
up to ten per post, stored under `wwwroot/uploads` with a generated GUID filename and served back as
static files. The extension is checked against a fixed list *and* against the file's own leading bytes,
because the extension is a claim the client makes and it is the claim that decides how the file gets
served back later — a document renamed `.png` is refused. SVG is not on the list at all: it is the one
image format that is also a document, and one that can carry script. The uploads themselves go out with
`nosniff` and a `default-src 'none'; sandbox` policy, so even a mistake in that reasoning has nothing
it is allowed to do. Filters are baked into the file at upload with `canvas`, so the photo looks the same to
everybody.

A video post carries a poster frame, grabbed from the clip in the browser that uploaded it and sent
alongside it. There is no video tooling behind the API, and without a poster a grid cell has no
thumbnail to draw — an `<img>` cannot render an MP4. The browser had the frame in its hands anyway, so
that is where it is taken.

A post's media is a table rather than a column, which is what turns a post into a carousel: the caption,
the likes and the comment thread stay on the post — there is still exactly one of each however many
photos you swipe through — while the thing you look at becomes an ordered list. The post keeps a cover
column, so a grid cell, a notification row or a post shared into a chat still reads one field and never
loads the run to draw a thumbnail.

---

## 4. Where the graph actually is

Everything visible in the app is a graph operation. They all live in `backend/InstaGraph.Api/Graph/` and
`Services/FeedService.cs`.

| What you see | What runs |
|---|---|
| Follow / unfollow | One row inserted or deleted in the directed edge table |
| Your feed | One hop for candidates, a random walk for the discovery slice, then affinity × engagement × recency |
| The story rings | Your out-edges, filtered to accounts that posted in the last 24 hours |
| "Suggested for you" | Six signals blended — Adamic–Adar, personalised PageRank, SALSA, Jaccard, reciprocity, community — then re-ranked for diversity |
| "Followed by nila + 2 more" | Intersection of two sorted adjacency lists |
| The Follow button | Both directions of the edge read at once — five states, not two |
| "Friends" | Out-edges intersected with in-edges: the pairs where the edge runs both ways |
| "2nd degree · through nila" | Breadth-first search with the parent chain rebuilt |
| "Popular in your circle" | SALSA over the bipartite graph of your circle of trust |
| "Same community" | Label propagation over the undirected projection |
| The network drawing | Your ego network, laid out by a force simulation |
| Node size in that drawing | Global PageRank |
| Explore's order | Engagement, lifted for anything two hops away |
| Block | Both edges deleted, plus a permanent filter applied to every later traversal |
| Mute | The edge kept and the content dropped — two different things |
| Private account | A gate on the edge: the edge does not exist until the owner accepts it |
| Inbox vs **message request** | One lookup: does an edge run from the recipient back to the sender? |
| "Who can message you" | The same lookup, made configurable — an edge, a two-cycle, or nothing |
| Who a **note** reaches | The intersection of a node's out-edges with its in-edges, narrowed by a named subset |
| Who a **story** reaches | The node's in-edges — its followers — narrowed by the same named subset |
| Who is told you came online | The accounts you share a thread with, filtered by both sides' settings |
| The new-message list | The interaction weight already on the edge, then reciprocity, then mutual count |
| **Favourites** in the feed | A named subset of your out-edges, added on top of everything inferred |
| Sending a message | `+1` to the weight on every edge between you — which the feed then reads as affinity |

### Blocking is the interesting one

Deleting the two edges is the obvious half and the insufficient half. Two accounts with no edge between
them are still two hops apart through anyone they both follow, so a suggestion would find a route back
within seconds.

So a block is also a **wall carried inside the graph snapshot**, and every traversal consults it:
`AdamicAdar` refuses to walk *through* a blocked account as an intermediary as well as refusing to land
on one, the random walk will not spend mass on it, `ShortestPath` routes around it, `SecondHop` does the
same, and the sorted-list intersection behind "Followed by …" skips them.
Above that, the SQL surfaces — search, explore, hashtag pages, follower lists, likes lists — each filter
by the same set.

Two smaller decisions:

- **A block is symmetric even though the row is directed.** Whoever pressed the button, neither can reach
  the other. `SocialGraph` stores it under both ids so no caller has to remember to check twice.
- **The blocked side is told nothing.** Loading that profile returns exactly the message an unknown
  handle returns, and a follow attempt fails with the same wording either way — so a block cannot be
  told apart from an account that never existed.

### A follow button has five states, because an edge has four

The follow is directed, so between any two accounts there are four possible arrangements, and a button
that only knows "am I following" collapses them into two. That is how a list ends up offering to follow
somebody you are already friends with: the row carried a username and nothing else, so the button had to
assume the edge did not exist.

| Edges between you | Button | What the click does |
|---|---|---|
| Neither | **Follow** | Adds your edge |
| Theirs only | **Follow back** | Closes the two-cycle |
| Yours, pending | **Requested** | Opens the sheet, to withdraw |
| Yours only | **Following** | Opens the sheet, to unfollow |
| Both | **Friends** | Opens the sheet, to unfollow |

So every payload that can carry a follow button — suggestions, the discover cards, followers, following,
friends, the mutuals list, the profile header — carries all four flags, computed once per page by
`RelationshipReader` rather than once per row. Three of them come straight off the graph snapshot; the
fourth, a pending request, deliberately does not, because a request is *not* an edge and the graph must
not be able to see it.

**Friends** is the interesting one, because nothing stores it. It is the intersection of a node's
out-edges with its own in-edges — one linear merge over two already-sorted lists — and it is the only
symmetric relationship a directed edge set has. Unfollowing a friend is therefore not the reverse of
following one: it removes your edge and leaves theirs standing, so they still follow you. The confirm
sheet says exactly that, because a destructive action ought to state what survives it.

### Muting is the opposite lesson

Muting changes no edges at all. You still follow them, your following count is unchanged, they still see
you as a follower, and they are never told. The only thing that happens is that the feed stops treating
their posts as candidates and the story row drops their ring.

It is worth having next to blocking because between them they separate two ideas that look like one:
**who you are connected to** and **what you are shown**.

### Adjacency lists in memory

`Follows` is the edge table. But the questions are recursive — "who do the people I follow follow?" —
and each hop in SQL is another self-join. So `GraphSnapshotProvider` loads the whole edge set into
`SocialGraph`, two dictionaries of sorted integer arrays, and every graph answer is computed there.

With V accounts a matrix would cost V² cells and a social network is almost entirely zeros; lists cost
O(V + E) and let a node's neighbours be walked in time proportional to *its* degree rather than to the
size of the network. That is what makes a two-hop suggestion affordable at all.

The trade is staleness. Writes call `Invalidate()` and the snapshot expires on a 20-second timer
regardless — which is also what production does; nobody serves suggestions from a perfectly current
graph.

### Four decisions worth knowing about

1. **Suggestions blend several measures, because no single one is right.** Each contributes what it is
   actually good at, normalised against the best reading in the same candidate pool:

   | Signal | What it answers | Why it is not enough alone |
   |---|---|---|
   | **Adamic–Adar** | Who do my people point at? Each shared connection contributes 1/ln(their following count) rather than 1, so a mutual who follows thirty accounts is real evidence and one who follows fifty thousand is nearly none | Blind past two hops |
   | **Personalised PageRank** | Where does a random walk from me actually spend its time? Every path counts, longer paths count geometrically less | Drifts toward whatever is centrally placed |
   | **SALSA over a circle of trust** | What do the people I trust collectively endorse, per unit of attention spent? | Needs a circle to exist first |
   | **Jaccard** | How much of what we each follow overlaps, as a *ratio* rather than a count? | Says nothing about who is in between |
   | **Reciprocity** | Have they already pointed an edge at me? | Only ever applies to a handful of people |
   | **Label propagation** | Did the edges put us in the same cluster? | Coarse — a community can be thousands of accounts |

   Raw fame is then **subtracted**, not rewarded, and the list is re-ranked so no more than two
   suggestions arrive through the same intermediary. Every weight sits in `appsettings.json` under
   `Graph`, and every row carries its own breakdown to the client — the info button on a suggestion shows
   the same numbers the ranking used.

2. **The discovery slice is reserved, not earned.** Score alone would never place a two-hop post: simply
   following somebody is worth several points, so every post from an account you chose outranks every
   post from one you did not. `Interleave` gives roughly one slot in four to posts from beyond your
   follows. Without it nothing could ever reach you from outside the set you already picked.

3. **An empty feed stays empty.** When you follow nobody the feed returns nothing rather than quietly
   serving Explore. Filling it with strangers would hide the one thing the app is built on — that your
   feed is made of your follows and nothing else. The client turns that into the get-started card.

4. **Saving is private and weightless.** A save notifies nobody, appears in no count, and is invisible to
   the author — unlike a like, which is public and feeds the ranking.

5. **Comment threading stops at one level.** Answering a reply attaches to the same parent rather than
   nesting deeper, so a long argument stays two levels and still fits on a phone. The tree is real —
   deleting a top-level comment removes its whole subtree, and because SQL Server will not cascade a
   self-referencing foreign key, the service does that walk explicitly.

### How a private account actually behaves

Privacy is a gate on the edge, not a flag on the content. Until the owner accepts, the edge does not
exist — so nothing downstream has to special-case it.

| | |
|---|---|
| Profile header | **Visible** — name, bio, and the counts. Private hides the photos, not the fact that the account is there |
| Posts, followers, following | **403** until accepted |
| Explore, hashtag pages | **Never** appear, accepted or not — those are public surfaces |
| Search | **Appears**, so you can find them in order to request |
| Following them | Creates a pending request, and **cancelling** it is just deleting that row |
| Accepting | Turns the pending row into a real edge, and moves both degree counters in the same transaction |
| Going public | **Accepts everyone already waiting** — leaving them pending would be a queue nobody could clear |
| Removing a follower | Deletes their edge to you from your end; the account closes to them again immediately |

### Messaging is a second graph, and a different kind of one

Everything above is one directed, unweighted, permanent edge set. A conversation is none of those things:
it is undirected, it is weighted by how much traffic runs along it, and it can exist between two accounts
with no follow between them in either direction. That last property is the whole reason message requests
exist — it is the only surface in the app a stranger can reach you through — so the two graphs are kept in
separate tables rather than hung off `Follow`, and they meet in exactly three places.

**Where the follow graph decides something.** When a thread is created, each recipient's membership row
is stamped `Accepted` or `Pending` by one lookup — `graph.IsFollowing(recipient, sender)`. An edge back
means the inbox; no edge means Requests. Nothing about the message is examined, and no other part of the
system has to know a request is different from a chat, because by the time anything reads it the answer
is already a column. Above that sits the account's own `MessagesFrom` rule, which is the same lookup made
configurable: everyone, an edge, a two-cycle, or nobody.

**Where the message graph writes back.** Every send adds `+1` to `InteractionScore` on whichever follow
edges exist between the people talking, and invalidates the snapshot. `InteractionScore` is the affinity
term the feed already multiplies by, so a conversation quietly lifts that person's photos — the honest
version of "your feed knows who you are close to". It is also what orders the new-message screen, which
is why the list of people to talk to gets better the more the app is used, without storing a "recent
chats" list anywhere.

**Where neither is allowed to leak into the other.** A block is checked from the snapshot on every send
and every thread creation, and returns the same "does not exist" wording a missing account gets. Read
receipts and presence are symmetric — switching yours off hides everybody else's from you, because a
setting that only worked one way would be a one-way mirror. And reading a message request does *not* mark
it read: opening one to decide whether you want it must not put "Seen" under the sender's message.

Three smaller decisions worth knowing about:

- **Per-member, not per-conversation.** Which folder a thread is in, how far it has been read, whether it
  is muted, pinned or deleted — all of it lives on `ConversationMember`, one row per person per thread.
  A request is pending for the recipient and perfectly ordinary for the sender; deleting a chat empties
  your copy and leaves theirs untouched, and a new message brings yours back empty above it. Any of those
  facts stored on the conversation would let one person's action change what somebody else sees.
- **An unsend keeps the row.** The text is cleared and the reactions are removed, but the row survives,
  because replies and reactions point at it — deleting it outright would leave an answer to nothing. It is
  the same reason a self-referencing comment reply uses `Restrict` rather than `Cascade`.
- **Typing and presence are never written down.** Both are worthless the moment they are a minute old, so
  storing them would mean a row update per keystroke to record something already stale. They live in one
  dictionary in the process, swept on read. The cost is honest and stated: they do not survive a restart,
  and behind more than one instance they would need Redis or a SignalR backplane.

### Stories are the third audience the same edges answer

A post is *pulled*: it sits on a profile, it is ranked into feeds, and it stays. A story is *pushed*: it
goes to everyone with an edge pointing at you, in a fixed row, in the order it was posted, and then it
stops existing. Nothing ranks a story, so nothing has to justify its order — which is exactly why it is
worth having next to a feed that does nothing but justify its order.

That gives three audiences off one edge set, and none of them is stored as a list of recipients. Each is
recomputed from the adjacency lists at the moment somebody looks, which is why gaining a follower makes
your ring appear for them with nothing backfilled:

| | Who it reaches | The operation |
|---|---|---|
| **Story** | Everyone who follows you | The node's in-edges |
| **Note** | Accounts you follow who follow you back | In-edges intersected with out-edges |
| **Either, marked private** | Your close friends | The above, intersected with a named subset |

Expiry is a filter on read rather than a delete job: a story past its twenty-four hours is simply never
selected. Muting is honoured for the same reason it is honoured in the feed — the edge stays, the content
goes — and a private account needs no special case at all, because "your followers" was already the rule.

Two decisions worth knowing about:

- **Who watched is visible to exactly one person.** A like is public and feeds the ranking; a save is
  private and notifies nobody. A story view is neither: the author sees the list, the viewer sees nothing,
  and nobody else can ask. It is the only piece of engagement in the app shaped like that, which is why it
  gets its own table rather than reusing either.
- **A reply is an ordinary direct message.** It carries the story it answers, and it goes through exactly
  the same gate every other message does — so answering the story of somebody who does not follow you back
  lands in their **requests**, not their inbox. The story did not create a relationship; it only travelled
  along one.

### Cold start: what to say when the graph knows nothing about you

A brand-new account has no edges, so every graph signal reads exactly zero — Adamic–Adar has no
intermediaries to weight, the random walk has nowhere to walk, label propagation has put the account in a
community of one. The ranking still runs; it just has nothing to rank with.

**Suggestions are still shown, and that is deliberate.** It is what every real network does, because the
alternative is an account that opens to an empty screen with no way to begin — the first thing Instagram
shows a new sign-up is a list of people to follow. Withholding suggestions until somebody already has
follows is a bootstrap that never starts.

What must not happen is claiming a reason the graph cannot support. So the fallbacks are ordered by how
much they actually know:

| What the graph found | What the row says |
|---|---|
| An accepted edge from them to you | **Follows you** |
| A route through somebody | **Followed by nila + 2 more** — the intermediary is named |
| Nothing, but the account only just arrived | **New to InstaGraph** |
| Nothing at all | **Suggested for you** |

**Who is even eligible to be a cold-start suggestion.** "Everybody, ordered by influence" is the wrong
pool to draw from once this is hosted somewhere real: on a young site nobody has any influence, so that
degenerates into handing every new arrival the complete member list. The bootstrap pool is therefore
limited to accounts that are **public** and have **posted at least once** — two things the account did,
rather than two things inferred about it. A private account has said it does not want to be found this
way; an account with nothing on it has given nobody a reason to follow it.

If nothing qualifies, the answer is an empty list, and the screen says so. An empty suggestion list is a
true statement about a new site. A list of everyone who has ever signed up is not. None of this narrows
what the graph found a route to — once there is an intermediary, the intermediary is the justification.

The last two are the honest ends of the scale. "Popular on InstaGraph" used to sit there, and it was a
claim the app could be caught in immediately: on a site with three accounts, nobody is popular.

The ordering underneath follows the same principle. With every score tied at zero, sorting by score alone
leaves whatever order the candidate pool enumerated, which is registration order — the least useful
answer available, because it buries whoever is actually using the app under whoever signed up first. So
ties fall back to follower count and then to recency: a prior rather than a ranking, and one that stops
applying the instant a single edge exists to say something better.

One row, one reason. The suggestion card carries the reason line and nothing else, because a category
chip underneath it only ever restated it. And when *nothing* in the list came out of the graph — no
intermediary, no route to anybody — the heading says **People on InstaGraph** rather than "Suggested for
you", with a line explaining that following somebody is what turns it into a real list. A heading that
claims a suggestion is personal, over a list of strangers the app cannot justify, is the one claim this
whole thing is not supposed to make.

**What that transition actually looks like.** Four accounts, where `b` follows `c` and `d`:

```
BEFORE — a follows nobody:
   d        reason="New to InstaGraph"     distance=-1   mutuals=0
   c        reason="New to InstaGraph"     distance=-1   mutuals=0
   b        reason="New to InstaGraph"     distance=-1   mutuals=0

AFTER — a follows b:
   d        reason="Followed by b"         distance=2    mutuals=1   via=b
   c        reason="Followed by b"         distance=2    mutuals=1   via=b
   …then everyone unconnected, below them
```

One edge is all it takes. The moment `a → b` exists, the two-hop pass has an intermediary to weight,
Adamic–Adar fires, and `c` and `d` arrive named — "Followed by b" — and outrank every account the graph
still cannot say anything about. Nothing was backfilled and no list was rebuilt: the same query simply
has a graph to walk now.

### Reels ask the same three questions with the weights turned around

The home feed and the reels feed run on the same three signals — how strong your edge to the author is,
how much the post has drawn, and how fresh it is. They are not the same feed with a filter on the end,
because they are answering different questions.

The home feed asks *what have the accounts I chose posted*, so affinity dominates: following somebody is
itself worth a point before any interaction has happened, and posts from people you picked outrank posts
from people you did not. That is correct for a feed you scroll to catch up, and it is why a quarter of the
slots have to be **reserved** for two-hop discovery — score alone would never place them.

Reels asks *what is worth watching*, and it has to answer mostly from outside the set you already follow,
because a vertical feed that only ever showed you people you follow runs out after two swipes. So affinity
is halved, being followed is worth a flat lift rather than a multiplier, being two hops away is worth
another, and engagement carries most of the order. Views count towards engagement alongside likes and
comments, which is the one signal reels has that the photo feed does not.

Everything else is the same rule stated again rather than inherited, because the query does not go
through the home feed: a private account's clip reaches its followers and nobody else, a block hides it
in both directions, and a mute keeps the edge while dropping the content.

**A view is one person, not one play.** It is a row per viewer, the same shape as a story view, and it is
written once — rewatching a clip four times does not make it look four times more popular. The client
only asks for it after three seconds of actual playback, so a clip that scrolled past in a tenth of a
second was never watched. Counting on `play` instead is exactly what makes view numbers meaningless.

### Real time is a second delivery route, never a second source of truth

One WebSocket per open tab, authenticated with the same JWT as everything else — in the query string,
because a socket handshake cannot carry a header, and accepted there for the hub path and nowhere else.

Every account joins exactly one group: its own. There are no per-conversation rooms. That costs one extra
send per member of a group chat and buys two things worth more than that. A payload can be built for the
person receiving it, so *is this mine* and *did I react to this* are answered on the server rather than
guessed at in the browser. And there is no membership bookkeeping to get wrong, which is where socket code
usually leaks — the one thing a client may push is "I am typing", and that is re-checked against the
membership table every single time.

| Pushed | When |
|---|---|
| `message`, `messageChanged` | Something was sent, unsent, or reacted to — mapped per recipient |
| `typing` | Held in memory for six seconds and never written down |
| `read` | Somebody read up to a message, and both sides have receipts on |
| `presence` | First socket opened or last one closed, to people you share a thread with |
| `notification`, `activityCount` | A like, comment, follow or mention, with the new badge |
| `story`, `post` | Somebody you follow posted — the fact, not the content |

Three rules keep it honest:

1. **Nothing is only realtime.** Every stream has an HTTP endpoint returning the same thing, and every
   screen still fetches on open. A dropped frame would otherwise become a permanently wrong screen.
2. **A reconnection means refetch, not resume.** Whatever happened while the socket was down was never
   delivered and never will be, so `resynced` tells every open list to ask again rather than pretend the
   gap did not exist.
3. **Polling survives as a fallback and only as a fallback.** The inbox and an open thread still hold a
   timer, and it fires only while `connected` is false. A browser behind a proxy that refuses to upgrade
   gets a slower app rather than a broken one.

The honest cost: presence and typing live in one process, so they do not survive a restart and would need
Redis or a SignalR backplane behind more than one instance. For a single API that is the right trade, and
the UI is built so a missing presence reads as *not shown* rather than as *offline*.

**What is deliberately not pushed** is the ranked feed. A new post arrives as a fact — "somebody you
follow posted" — and the client offers a **New post** pill. Inserting the photo directly would mean the
client deciding where in a ranked list it belongs, which is the one question only the ranking can answer.

### Close friends and favourites are labels on edges you already have

Neither creates an edge, and neither can stand in for one. Close friends is drawn from the accounts that
follow **you** — a private note is no use to somebody who could never see it. Favourites is drawn from the
accounts **you** follow, because the entire effect is on your own feed. Same table, same shape, opposite
directions of the same edge set, and the API refuses to put somebody on either list without the edge that
makes them eligible.

Favourites is also the only signal in the feed ranking that was *stated* rather than *inferred*, which is
why it is added on top of the blended score rather than mixed into it, and why `FavoriteBoost` is large.

The feed weights live in `appsettings.json` under `Feed`, and the suggestion weights under `Graph`.
Changing `AffinityWeight`, `RecencyHalfLifeHours`, `ReciprocityWeight` or `CelebrityPenalty` visibly
changes the order, which is the point of having them there. `RestartProbability` is the most instructive
one to move: raise it and suggestions huddle closer to the accounts you already follow, lower it and the
walk wanders out into the rest of the graph.

---

## 5. API

Base address `http://localhost:5120/api`. Everything except the sign-up calls, the password-reset
calls and login needs `Authorization: Bearer <token>`.

Two status codes are worth knowing about. **429** comes from the sign-in lockout and means the password
is no longer being checked, so it is deliberately not a 401. **401** on a token that has not expired
means the account's password changed after it was issued — sign in again.

| Group | Endpoints |
|---|---|
| **Auth** | `POST /auth/signup/start`, `POST /auth/signup/resend`, `POST /auth/signup/verify`, `GET /auth/username-available?username=`, `POST /auth/register`, `POST /auth/login`, `GET /auth/me` |
| **Passwords** | `POST /auth/password/forgot`, `POST /auth/password/resend`, `POST /auth/password/verify`, `POST /auth/password/reset` — all anonymous; `POST /auth/password/change` needs the session and the current password. The first four answer identically for an account that does not exist |
| **Feed** | `GET /feed`, `GET /feed/explore`, `GET /feed/reels`, `GET /feed/highlights` |
| **Posts** | `POST /posts` (multipart: `media` ×10, `posters`, `posterFor`, `aspectRatios`, `durations`), `GET /posts/{id}`, `PUT /posts/{id}`, `DELETE /posts/{id}`, `POST\|DELETE /posts/{id}/like`, `POST\|DELETE /posts/{id}/save`, `GET /posts/{id}/likes`, `POST /posts/{id}/view` |
| **Post extras** | `PUT /posts/{id}/tags`, `POST\|DELETE /posts/{id}/archive`, `POST\|DELETE /posts/{id}/pin`, `PUT /posts/{id}/collection` |
| **Comments** | `GET\|POST /posts/{id}/comments` (`parentId` makes it a reply), `DELETE /posts/comments/{id}`, `POST\|DELETE /posts/comments/{id}/like` |
| **Users** | `GET /users/{username}`, `/posts`, `/followers`, `/following`, `/friends`, `POST\|DELETE /users/{username}/follow`, `DELETE /users/{username}/follower` |
| **Relationships** | `POST\|DELETE /users/{username}/block`, `POST\|DELETE /users/{username}/mute` |
| **Me** | `PUT /users/me`, `POST /users/me/avatar` (multipart), `GET /users/me/saved?collectionId=`, `GET /users/me/archive`, `GET /users/me/blocked` |
| **Collections** | `GET\|POST /users/me/collections`, `PUT\|DELETE /users/me/collections/{id}` |
| **Tagged** | `GET /users/{username}/tagged` |
| **Discovery** | `GET /users/suggestions`, `GET /users/search?q=` |
| **Graph** | `GET /graph/suggestions?category=`, `GET /graph/path/{username}`, `GET /graph/network?depth=`, `GET /graph/stats`, `GET /graph/mutuals/{username}` |
| **Requests** | `GET /users/follow-requests`, `POST /users/follow-requests/{username}/accept\|reject` |
| **Hashtags** | `GET /hashtags/trending`, `GET /hashtags/{tag}/posts` |
| **Notifications** | `GET /notifications`, `/unread-count`, `POST /notifications/read-all` |
| **Inbox** | `GET /messages?folder=inbox\|requests\|spam`, `GET /messages/counts`, `GET /messages/candidates?q=` |
| **Threads** | `POST /messages` (open one), `GET /messages/{id}?before=`, `PUT /messages/{id}` (mute, pin), `DELETE /messages/{id}`, `POST /messages/{id}/leave` |
| **Messages** | `POST /messages/{id}/messages`, `POST /messages/{id}/photo` (multipart), `POST /messages/share`, `DELETE /messages/messages/{id}` (unsend), `POST /messages/messages/{id}/react` |
| **Chat state** | `POST /messages/{id}/read`, `/typing`, `/accept`, `/decline?spam=` |
| **Notes** | `GET\|POST\|DELETE /notes` |
| **Settings** | `GET\|PUT /settings`, `GET /settings/activity` |
| **Lists** | `GET /settings/lists/{close-friends\|favorites}`, `POST\|DELETE /settings/lists/{kind}/{username}` |
| **Muted** | `GET /users/me/muted` |
| **Stories** | `POST /stories` (multipart), `GET /stories` (the ring row), `GET /stories/{username}`, `POST /stories/{id}/view`, `GET /stories/{id}/viewers`, `POST /stories/{id}/reply`, `DELETE /stories/{id}` |
| **Highlights** | `GET /highlights/user/{username}`, `GET /highlights/{id}`, `POST /highlights`, `PUT\|DELETE /highlights/{id}`, `GET /highlights/archive` |
| **Realtime** | `/hubs/realtime` — SignalR, JWT in `?access_token=`, client method `Typing(conversationId)` |

Every failure, including validation, comes back in one shape:

```json
{
  "statusCode": 409,
  "message": "That username is taken.",
  "path": "/api/auth/register",
  "timestamp": "2026-08-14T05:30:00Z"
}
```

Lists return `{ items, pageNumber, pageSize, hasMore }`. `hasMore` is answered by fetching one row more
than the page needs, so no list endpoint pays for a second `COUNT`.

---

## 6. Architecture

**Backend**

```
Controllers      HTTP only: authorize, validate, delegate
    ↓
Services         social rules, visibility, ownership; build DTOs
    ↓
AppDbContext → SQL Server        Graph\ → adjacency lists in RAM (everything recursive)
```

Entities are never returned from a controller. Every foreign key that matters uses
`DeleteBehavior.Restrict`, so deleting a post removes its dependants explicitly and in order. Unique
indexes on username, email, the ordered follow pair, the (post, user) like pair and the (post, user) save
pair; a check constraint forbids an account following itself. Follower, following and post counts are
denormalised and moved inside the same transaction as the edge that changed them.

**Frontend** — `core/` (models, one API service, guards, interceptors, theme, vibes), `shared/` (post
card, grid, stories, suggestions, skeletons, avatar, the vibe sheet, the profile card), `layout/` (the
sidebar shell), `features/` (one folder per screen). Every component is standalone and `OnPush` and
holds its state in signals. Every feature route is lazily loaded. Loading states are skeletons shaped
like the content, so nothing jumps when it arrives.

**Appearance is two independent axes, not one list of themes.** `data-theme` on `<html>` decides light
or dark and owns the neutral scale; `data-vibe` decides the colour and owns the accent, the brand
gradient, the story rings, the glow and the three blobs washing the page background. Neither block
touches the other's tokens, which is what lets Cyber work in daylight and Matcha work at night without a
fourteen-way matrix of palettes. Both default to writing *no* attribute — `system` and `aurora` are the
values already sitting in `:root` — and both are stamped by a small script in `index.html` before
Angular boots, so the first paint is never the wrong colour.

Two details in that layer are load-bearing rather than decorative. The frost on `.card` is applied to a
`::before` rather than to the card itself, because an element carrying a `backdrop-filter` becomes the
containing block for every `position: fixed` descendant — a card with the filter on it would trap the
confirm dialog inside any follow button it happened to contain. A story ring's rotation is on its own
layer for the same class of reason: one element cannot animate its `transform` and be scaled by a hover
at the same time.

Because a vibe's gradient can run through very light stops, every vibe also carries a `--brand-ink`:
the text colour that stays readable across all three of its stops. Anything filled with `--brand` reads
its ink from there rather than assuming white, which is the difference between Cyber being a colour
scheme and Cyber being an unreadable one.

---

## 7. Verification performed

> **Suite eight — passwords and lockouts, 28 checks over HTTP, all passing.** `node tools/passwords.js`
> walks the half of auth the other suites never reach, because they sign in once with a password they
> already know: what the policy refuses (too short, one character class, the username inside it, one off
> the common list, the one already in use), changing a password from settings with the current one, and
> resetting a forgotten one end to end.
>
> The checks that matter are the ones about what a password change *does*. The token held before the
> change stops working and the one handed back with it does; the old password no longer signs in and the
> new one does; the reset token is refused the second time it is presented; and a login that does not
> exist gets the same answer as one that does. Then the lockout: five wrong passwords and the sixth
> attempt comes back 429 saying how long, and **the correct password is refused too** while the lock is
> on — which is the assertion that separates a real lockout from a counter nobody consults.
>
> It **writes to the database** and deliberately locks an account out, so point it at a scratch
> connection string rather than one that is meant to stay empty.
>
> **Suite six — every endpoint, 146 checks over HTTP, all passing.** `node tools/smoke.js` registers
> three accounts and exercises **all 106 routes the API exposes** — the coverage is derived from the
> server's own OpenAPI document rather than a hand-kept list, so it cannot quietly fall behind a new
> route. It walks each screen's requests in the order that screen makes them: the feed, the ring row,
> explore, reels, the graph endpoints, a two-photo carousel, a video post (checking it is flagged as a
> reel and covered by its poster rather than the MP4), the whole post page, photo tags and the Tagged
> tab, collections, pin, archive, stories, highlights and the story archive, the messaging corners —
> requests, spam, groups, reactions, unsend, sharing — follow requests against a private account,
> settings, blocking, muting, and every undo of all of it.
>
> It found two real defects, both now fixed: deleting a post that had ever been shared into a chat
> failed outright on a restricted foreign key, and the profile page turned its spinner for ever on any
> failure instead of saying what went wrong.
>
> Two of its own fixtures were wrong as well, and had been passing for the wrong reason: the video it
> uploaded was the string `not-really-a-video-but-the-api-only-checks-the-extension` and the poster
> beside it was PNG bytes named `.jpg`. Both were true when they were written. Neither is now that the
> uploader reads the leading bytes, so both are real headers, and two checks were added for the cases
> that matters — a document renamed `.png`, and an SVG — which are refused.
>
> **Suite seven — the very first account, 36 checks, all passing.** `node tools/first-run.js` signs up
> one account on an empty database and asks every screen for its data. It exists because that is the one
> state nothing else reaches: a graph with a single node and no edges, which is where graph code breaks
> — a walk with nowhere to walk, a PageRank over one vertex, a clustering coefficient whose denominator
> is the number of pairs of neighbours you have not got. Every endpoint answers with a well-formed empty
> rather than a 500, and the shapes are checked too, so an empty list cannot quietly become `null`.
>
> It **writes to the database**, and there is no delete-account endpoint to undo that — so against a
> database that is meant to stay empty, clear up after it.
>
> Alongside it: both halves compile with no warnings, the migration applies to an existing database
> without touching a row of the data already there — `Purpose` defaults to `SignUp`, which is what every
> existing verification row is, and `PasswordChangedAt` is null for an account still on the password it
> signed up with, which is also correct. The API starts against it and rebuilds the graph,
> every new route is present and correctly shaped in the generated OpenAPI document, every lazy route
> resolves to a real exported component, and every literal `routerLink` lands on a declared route.
>
> **What is still unverified is the browser.** No suite here drives a real signed-in click-through —
> laying out a carousel, watching a clip play as it scrolls into view, placing a tag by tapping a photo,
> installing the app to a home screen. Those need eyes on a screen, and the checks above cannot stand in
> for them.

**99 checks were run against the messaging and stories build and all pass** — 86 over HTTP and 13 driven through a live
socket by two real SignalR clients. They are suites three, four and five below. Suites one and two, the
110 checks recorded when the original walkthrough was built, are listed after them for reference and
were not re-run for this change.

Suite five — the socket, driven by two real SignalR clients against a running API (13 checks):

- two accounts connect and both reach `Connected`
- a message sent by one **arrives at the other without it asking**, carrying the right conversation id,
  and mapped for the recipient — `isMine` is false for them and true on the sender's own echo
- `Typing` invoked on the hub reaches the other side with the right username
- marking a thread read pushes `read` back to the sender
- a like pushes both a `notification` naming the actor and a fresh `activityCount`
- posting a story pushes `story` to a follower
- closing the last socket pushes `presence` with `online: false` to somebody sharing a thread

Suite four — stories and the hub surface (29 checks):

- **audience**: a follower sees the ring, a stranger sees nothing and is refused with 403, and the author
  always sees their own
- **seen state**: unseen until opened, then seen — for that viewer only; the view count moves for the
  author and stays at zero for everybody else
- **the viewers list**: readable by the author, 403 for the person who watched
- **close friends**: a follower who is not on the list sees one story where somebody on it sees two
- **muting**: the ring goes, the follow stays, and unmuting brings it back
- **replies**: arrive as a `StoryReply` message carrying the story, land under **requests** when the
  author does not follow back, and cannot be sent to your own story
- **deleting**: the story goes, the reply that answered it keeps its text, later views 404, and only the
  author may delete
- **the hub**: anonymous negotiate is 401, an authorised one returns a connection token and offers
  WebSockets, a token in the query string is accepted for `/hubs` and refused everywhere else


Suite three — messaging, notes, lists and settings (57 checks), run against a live API:

- **the request gate**: with no edge either way the thread is absent from the recipient's inbox and
  present under Requests, while sitting normally in the sender's inbox; with an edge back it goes straight
  to the inbox instead; accepting moves it; and answering a request accepts it
- **read receipts**: opening a request does *not* mark it read, so no "Seen" appears for the sender; once
  accepted, reading it does — and both sides having receipts on is required for either to see it
- **hidden words**: a request containing one is filed under Spam rather than Requests, and a comment
  containing one is refused with the same wording somebody outside the audience gets
- **`MessagesFrom`**: `NoOne` refuses a brand new thread with 403 and leaves an existing one working
- **blocking**: neither side can open a thread or send into an existing one, both with the same 404 an
  unknown account returns
- **messages**: reactions add and toggle off, replies carry the quote, an unsend leaves the row so the
  reply still resolves, and unsending somebody else's is 403
- **groups**: one thread with everybody in it, a title, a system line on leave, the leaver loses access,
  a non-member gets 404, and a one-to-one thread cannot be left
- **deleting a chat**: gone from your inbox, still in theirs, and back in yours when a new message arrives
- **sharing**: one post into two chats at once, arriving as a card that still carries the photo
- **notes**: invisible to a non-mutual, visible once the edge runs both ways, hidden again when marked
  close-friends-only, and visible to somebody added to that list
- **lists**: a favourite you do not follow is refused, one you do follow is accepted, and the counts move
- **the two graphs meeting**: the graph version hash moves after a message is sent — the edge weight
  genuinely changed — and the person messaged rises to the top of the new-message list
- **also**: photo messages, typing, mute, pin, the muted-accounts list and the activity summary

Suite two — blocking, muting, mentions, threads and privacy (63 checks):

- **blocking**: a two-hop suggestion that existed a moment earlier disappears even though the route
  through the shared follow is untouched; the blocked account also leaves search, explore, hashtag pages
  and follower lists; their posts return 404 rather than 403, so a block cannot be told from a deletion;
  the blocked side gets the same "does not exist" answer for the profile and the same wording on a
  refused follow; a block deletes edges in both directions, and unblocking restores visibility without
  restoring the follows
- **muting**: the posts and the story ring go, the edge and both counts stay, and the muted account still
  sees the muter as a follower — then unmuting brings the posts back
- **mentions**: `@handle` in a caption and in a comment each notify that account
- **threads**: a reply attaches to its parent, a reply *to a reply* flattens onto the same parent,
  replies are nested under their root rather than repeated at top level, comment likes notify the
  comment's author, and deleting a top-level comment removes its whole subtree from the count
- **privacy**: request instead of edge, header visible but posts and lists 403, never in explore or on a
  hashtag page, a sent request can be cancelled, accepting opens the posts, removing a follower closes
  them again, and going public accepts everyone already queued
- **editing**: a caption edit re-derives the hashtags and drops the post off the old tag's page;
  editing somebody else's is 403

Suite one — the empty-database walkthrough (47 checks):

- an empty install: the first account registers, and its feed, suggestions, story row and explore all
  come back empty rather than erroring or inventing content
- posting: real multipart upload stored and served back as `image/png`, hashtags parsed from the
  caption, location kept, a post with no photo → 400
- the graph waking up: before following, the feed is empty even though others have posted; one follow
  fills it and puts a ring in the story row; a second-hop account then appears under suggestions,
  labelled with the account it came through; the mutual follower shows on the profile
- likes, comments and saves: counters, the likes list, saves private to the person who made them and
  absent from another account's saved tab, unsave clearing it
- notifications: follow, like and comment all arrive; a save notifies nobody
- privacy: an account goes private, a follow becomes a request, posts stay 403 until it is accepted,
  and explore never shows a private account
- rules: cannot delete somebody else's post, follow yourself, take a taken username, or post without a
  photo — and can delete your own

`dotnet build` completes with **zero warnings and zero errors**. `npm run build` produces a **385 kB
initial bundle (92 kB transferred)** with no warnings. The messages, settings and story screens are lazy
chunks, and so is the SignalR client itself — a signed-out visitor on the login screen downloads none of
it.

**Not verified:** the screens were not opened in a browser during this build — browser tooling was not
available — so the UI is verified by a clean production compile, by the API contract behind every screen,
and, for the live parts, by two real socket clients exercising the same events the browser subscribes to.
What that does not cover is layout: nobody has looked at these screens.
