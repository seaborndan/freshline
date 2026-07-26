using Freshline.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Freshline.Infrastructure.Tests;

/// <summary>
/// A real SQL Server database, created from the migrations in source control.
///
/// Not an in-memory provider, deliberately. The property under test is that a unique index on
/// (SourceId, ExternalId) makes a repeated window a no-op — and EF's in-memory provider does not
/// enforce unique indexes at all, so a broken upsert would pass against it. A test that would pass
/// against a wrong implementation is worse than no test.
///
/// Running <see cref="RelationalDatabaseFacadeExtensions.MigrateAsync"/> rather than
/// <c>EnsureCreated</c> is also deliberate: it means every test run proves the committed
/// migrations actually apply, rather than testing a schema derived from the model that no
/// deployment will ever use.
/// </summary>
public sealed class SqlServerFixture : IAsyncLifetime
{
    /// <summary>
    /// Defaults to the throwaway local instance from <c>docker-compose.yml</c>. That password is
    /// already in the compose file and guards nothing but a container full of public open data —
    /// it is not a secret, and no real credential is ever read from source.
    /// </summary>
    private const string DefaultConnectionString =
        "Server=localhost,1433;Database=Freshline_Tests;User Id=sa;Password=Freshline_Local_2026!;TrustServerCertificate=True";

    public string ConnectionString { get; } =
        Environment.GetEnvironmentVariable("FRESHLINE_TEST_CONNECTIONSTRING") ?? DefaultConnectionString;

    public async Task InitializeAsync()
    {
        await using FreshlineDbContext dbContext = CreateDbContext();

        try
        {
            // A clean slate per run. Row counts are the assertion, so leftovers from a previous
            // run would not fail the test — they would make it meaningless, which is worse.
            await dbContext.Database.EnsureDeletedAsync();
            await dbContext.Database.MigrateAsync();
        }
        catch (Exception exception)
        {
            throw new InvalidOperationException(
                "Could not reach SQL Server. These are integration tests and they are supposed to " +
                "need a real database: run `docker compose up -d` and wait for the container to " +
                "report healthy, or set FRESHLINE_TEST_CONNECTIONSTRING to point somewhere else. " +
                "They fail rather than skip on purpose, because a silently skipped test looks " +
                $"exactly like a passing one. Connection string in use: {ConnectionString}",
                exception);
        }
    }

    public Task DisposeAsync() => Task.CompletedTask;

    public FreshlineDbContext CreateDbContext()
        => new(new DbContextOptionsBuilder<FreshlineDbContext>()
            .UseSqlServer(ConnectionString, sqlServer => sqlServer.UseNetTopologySuite())
            .Options);
}
