using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace InstaGraph.Api.Common;

/// <summary>
/// Writes every <see cref="DateTime"/> as UTC with an explicit <c>Z</c>.
/// <para>
/// Without this the API emits <c>2026-08-14T07:56:24.79</c> — no timezone marker at all. The ECMAScript
/// spec says a bare date-time string like that is interpreted as <em>local</em> time, so a browser in
/// UTC+5:30 reads a post created one second ago as five and a half hours old. Every relative timestamp in
/// the app is then wrong by the viewer's offset.
/// </para>
/// <para>
/// The cause is that SQL Server's <c>datetime2</c> stores no offset, so EF Core hands back
/// <see cref="DateTimeKind.Unspecified"/> even though the value was written as
/// <see cref="DateTime.UtcNow"/>. Everything in this application stores UTC, so an unspecified kind is
/// safely treated as UTC here rather than being converted.
/// </para>
/// </summary>
public class UtcDateTimeConverter : JsonConverter<DateTime>
{
    private const string Format = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'";

    public override DateTime Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options) =>
        reader.GetDateTime().ToUniversalTime();

    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options) =>
        writer.WriteStringValue(AsUtc(value).ToString(Format, CultureInfo.InvariantCulture));

    internal static DateTime AsUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),

        // Straight out of SQL Server. The column holds a UTC value; only the label is missing.
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc)
    };
}

/// <summary>The same rule for nullable columns, so one path cannot drift from the other.</summary>
public class NullableUtcDateTimeConverter : JsonConverter<DateTime?>
{
    private const string Format = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'";

    public override DateTime? Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options) =>
        reader.TokenType == JsonTokenType.Null ? null : reader.GetDateTime().ToUniversalTime();

    public override void Write(Utf8JsonWriter writer, DateTime? value, JsonSerializerOptions options)
    {
        if (value is null)
        {
            writer.WriteNullValue();
            return;
        }

        writer.WriteStringValue(
            UtcDateTimeConverter.AsUtc(value.Value).ToString(Format, CultureInfo.InvariantCulture));
    }
}
