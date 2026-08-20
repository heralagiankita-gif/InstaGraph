using InstaGraph.Api.Common;
using InstaGraph.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace InstaGraph.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/[controller]")]
[Produces("application/json")]
public abstract class ApiControllerBase(ICurrentUser currentUser) : ControllerBase
{
    /// <summary>The signed-in account. Every service takes it explicitly rather than reaching for it.</summary>
    protected int UserId => currentUser.RequiredId;

    /// <summary>
    /// Clamps paging so a caller cannot ask for page 0 or for ten thousand rows in one response.
    /// </summary>
    protected static (int Page, int Size) Paging(int page, int pageSize, int defaultSize = 12, int maxSize = 50)
    {
        if (page < 1)
        {
            throw AppException.BadRequest("Page numbers start at 1.");
        }

        if (pageSize < 1)
        {
            pageSize = defaultSize;
        }

        if (pageSize > maxSize)
        {
            throw AppException.BadRequest($"Page size cannot be larger than {maxSize}.");
        }

        return (page, pageSize);
    }
}
