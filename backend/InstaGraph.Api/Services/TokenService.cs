using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using InstaGraph.Api.Common;
using InstaGraph.Api.Entities;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace InstaGraph.Api.Services;

public interface ITokenService
{
    (string Token, DateTime ExpiresAt) Create(User user);
}

/// <summary>Claim names this app adds to the standard set.</summary>
public static class InstaGraphClaims
{
    /// <summary>
    /// When the token was issued, in UTC ticks.
    ///
    /// <para>
    /// A private claim rather than the registered <c>iat</c>, because <c>iat</c> is written by the
    /// library from a value this code does not set and therefore does not control. What it is compared
    /// against — the moment an account last changed its password — has to be exact, so the value it is
    /// compared with is one written here on purpose.
    /// </para>
    /// </summary>
    public const string IssuedAtTicks = "iat_ticks";
}

public class TokenService(IOptions<JwtSettings> settings) : ITokenService
{
    private readonly JwtSettings _jwt = settings.Value;

    public (string Token, DateTime ExpiresAt) Create(User user)
    {
        var issuedAt = DateTime.UtcNow;
        var expiresAt = issuedAt.AddMinutes(_jwt.DurationInMinutes);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Name, user.Username),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),

            // Read back by the bearer handler, which refuses anything issued before the account last
            // changed its password. Without it a password change would leave every other session running.
            new(InstaGraphClaims.IssuedAtTicks, issuedAt.Ticks.ToString())
        };

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwt.SecretKey));

        var token = new JwtSecurityToken(
            issuer: _jwt.Issuer,
            audience: _jwt.Audience,
            claims: claims,
            expires: expiresAt,
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));

        return (new JwtSecurityTokenHandler().WriteToken(token), expiresAt);
    }
}

/// <summary>Reads the signed-in account out of the request, so services never touch HttpContext.</summary>
public interface ICurrentUser
{
    int? Id { get; }

    /// <summary>The id, or a 401 if there is not one.</summary>
    int RequiredId { get; }
}

public class CurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    public int? Id
    {
        get
        {
            var raw = accessor.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier);
            return int.TryParse(raw, out var id) ? id : null;
        }
    }

    public int RequiredId => Id ?? throw AppException.Unauthorized();
}
