using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Freshline.Infrastructure.Persistence;

/// <summary>
/// Used only by <c>dotnet ef</c> at design time, never at runtime.
///
/// Without this, generating a migration requires EF to boot a host project, which means the
/// migration tooling depends on the worker's configuration being valid — a strange coupling that
/// bites hardest in CI, where no connection string exists. The connection string here is never
/// connected to for <c>migrations add</c>: EF needs a provider to know how to translate the model
/// into SQL, not a reachable server.
/// </summary>
public sealed class FreshlineDbContextFactory : IDesignTimeDbContextFactory<FreshlineDbContext>
{
    public FreshlineDbContext CreateDbContext(string[] args)
    {
        string connectionString =
            Environment.GetEnvironmentVariable("FRESHLINE_CONNECTIONSTRING")
            ?? "Server=localhost,1433;Database=Freshline;User Id=sa;TrustServerCertificate=True";

        DbContextOptions<FreshlineDbContext> options =
            new DbContextOptionsBuilder<FreshlineDbContext>()
                .UseSqlServer(connectionString)
                .Options;

        return new FreshlineDbContext(options);
    }
}
