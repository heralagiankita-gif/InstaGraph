using InstaGraph.Api.Common;
using InstaGraph.Api.Entities;
using Microsoft.Extensions.Options;

namespace InstaGraph.Api.Services;

public interface IImageStorage
{
    /// <summary>Saves an uploaded photo and returns the relative URL to serve it from.</summary>
    Task<string> SaveAsync(IFormFile file, CancellationToken ct = default);

    /// <summary>
    /// Saves a photo or a clip, and says which of the two it turned out to be.
    /// <para>
    /// The kind is decided here rather than by the client, because the client is the one thing in the
    /// exchange that can lie about it — and the player the browser opens later is chosen from this answer.
    /// </para>
    /// </summary>
    Task<(string Url, MediaKind Kind)> SaveMediaAsync(IFormFile file, CancellationToken ct = default);

    /// <summary>Deletes a previously saved file. Silent if it is already gone.</summary>
    void Delete(string? relativeUrl);

    bool Exists(string relativeUrl);
}

public class ImageStorage : IImageStorage
{
    private readonly UploadSettings _settings;
    private readonly string _root;
    private readonly ILogger<ImageStorage> _logger;

    public ImageStorage(IOptions<UploadSettings> settings, IWebHostEnvironment env, ILogger<ImageStorage> logger)
    {
        _settings = settings.Value;
        _logger = logger;

        var webRoot = string.IsNullOrWhiteSpace(env.WebRootPath)
            ? Path.Combine(env.ContentRootPath, "wwwroot")
            : env.WebRootPath;

        _root = Path.Combine(webRoot, _settings.Folder);
        Directory.CreateDirectory(_root);
    }

    public async Task<string> SaveAsync(IFormFile file, CancellationToken ct = default) =>
        await WriteAsync(file, _settings.AllowedExtensions, _settings.MaxBytes, "photo", ct);

    public async Task<(string Url, MediaKind Kind)> SaveMediaAsync(
        IFormFile file, CancellationToken ct = default)
    {
        var extension = Path.GetExtension(file?.FileName ?? string.Empty);

        // Which list the extension is on is what makes it a video, and the two lists have different
        // ceilings — so the limit is picked before the file is read, not after.
        var isVideo = _settings.VideoExtensions.Contains(extension, StringComparer.OrdinalIgnoreCase);

        var url = isVideo
            ? await WriteAsync(file!, _settings.VideoExtensions, _settings.MaxVideoBytes, "video", ct)
            : await WriteAsync(file!, _settings.AllowedExtensions, _settings.MaxBytes, "photo", ct);

        return (url, isVideo ? MediaKind.Video : MediaKind.Image);
    }

    private async Task<string> WriteAsync(
        IFormFile file, string[] allowed, long maxBytes, string noun, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
        {
            throw AppException.BadRequest($"Choose a {noun} to post.");
        }

        if (file.Length > maxBytes)
        {
            var limit = maxBytes / (1024 * 1024);
            throw AppException.BadRequest($"That {noun} is larger than {limit} MB.");
        }

        var extension = Path.GetExtension(file.FileName);

        if (string.IsNullOrWhiteSpace(extension) ||
            !allowed.Contains(extension, StringComparer.OrdinalIgnoreCase))
        {
            throw AppException.BadRequest(
                $"That file type is not supported. Use {string.Join(", ", allowed)}.");
        }

        // The extension is a claim, not a fact, and the two checks above both take it at its word. This
        // is the one that does not: the first bytes of the file have to agree with what it says it is.
        //
        // It matters because the extension decides how the file is served later. A script saved as
        // .png is inert; an HTML document saved as .png and served back as text/html is not, and the
        // browser will happily sniff its way to that conclusion if the bytes look like markup.
        await VerifyContentAsync(file, extension, noun, ct);

        // Never trust the client's filename: it is only used for its extension, and even that is checked
        // against a fixed list. The stored name is one we generate.
        var fileName = $"{Guid.NewGuid():N}{extension.ToLowerInvariant()}";
        var fullPath = Path.Combine(_root, fileName);

        await using (var stream = new FileStream(fullPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        {
            await file.CopyToAsync(stream, ct);
        }

        _logger.LogInformation("Stored upload {File} ({Bytes} bytes).", fileName, file.Length);

        return $"/{_settings.Folder}/{fileName}";
    }

    /// <summary>
    /// Reads the first few bytes and checks them against the signature the extension implies.
    ///
    /// <para>
    /// Deliberately a short list of the formats actually accepted rather than a general-purpose decoder:
    /// the question is not "what is this file", which is hard, but "is this file the thing it says it
    /// is", which is a byte comparison. Anything not recognised is refused, so a new format has to be
    /// added here as well as to the settings — which is the correct amount of friction for the decision
    /// of what the app will serve back to a browser.
    /// </para>
    /// </summary>
    private static async Task VerifyContentAsync(
        IFormFile file, string extension, string noun, CancellationToken ct)
    {
        var header = new byte[16];

        await using (var stream = file.OpenReadStream())
        {
            var read = await stream.ReadAtLeastAsync(header, header.Length, throwOnEndOfStream: false, ct);

            if (read < 12)
            {
                throw AppException.BadRequest($"That {noun} is empty or damaged.");
            }
        }

        var ok = extension.ToLowerInvariant() switch
        {
            ".jpg" or ".jpeg" => Starts(header, [0xFF, 0xD8, 0xFF]),
            ".png" => Starts(header, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
            ".gif" => Starts(header, "GIF87a"u8) || Starts(header, "GIF89a"u8),

            // RIFF????WEBP — the four bytes in the middle are the length, so they are skipped.
            ".webp" => Starts(header, "RIFF"u8) && Starts(header.AsSpan(8), "WEBP"u8),

            // An ISO base-media file: four bytes of length, then the brand.
            ".mp4" or ".m4v" => Starts(header.AsSpan(4), "ftyp"u8),

            // QuickTime is the format ISO base media was derived from, and it does not insist that ftyp
            // comes first — a .mov written by a camera often opens on one of these instead. Accepting
            // only ftyp here would refuse files that are perfectly valid.
            ".mov" => Starts(header.AsSpan(4), "ftyp"u8)
                      || Starts(header.AsSpan(4), "moov"u8)
                      || Starts(header.AsSpan(4), "mdat"u8)
                      || Starts(header.AsSpan(4), "wide"u8)
                      || Starts(header.AsSpan(4), "free"u8)
                      || Starts(header.AsSpan(4), "skip"u8)
                      || Starts(header.AsSpan(4), "pnot"u8),

            // Matroska, which WebM is a profile of.
            ".webm" => Starts(header, [0x1A, 0x45, 0xDF, 0xA3]),

            _ => false
        };

        if (!ok)
        {
            throw AppException.BadRequest(
                $"That file is not a valid {noun}. Its contents do not match its {extension} extension.");
        }
    }

    private static bool Starts(ReadOnlySpan<byte> data, ReadOnlySpan<byte> signature) =>
        data.Length >= signature.Length && data[..signature.Length].SequenceEqual(signature);

    public void Delete(string? relativeUrl)
    {
        if (string.IsNullOrWhiteSpace(relativeUrl))
        {
            return;
        }

        try
        {
            var fileName = Path.GetFileName(relativeUrl);
            var fullPath = Path.Combine(_root, fileName);

            if (File.Exists(fullPath))
            {
                File.Delete(fullPath);
            }
        }
        catch (Exception ex)
        {
            // A leftover file is a housekeeping problem, not a reason to fail the user's delete.
            _logger.LogWarning(ex, "Could not remove {Url} from disk.", relativeUrl);
        }
    }

    public bool Exists(string relativeUrl) =>
        !string.IsNullOrWhiteSpace(relativeUrl) && File.Exists(Path.Combine(_root, Path.GetFileName(relativeUrl)));
}
