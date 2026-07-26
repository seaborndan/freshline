using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace Freshline.Api.Tests;

/// <summary>
/// Starts the real API host in memory, pointed at the test database.
///
/// <para>The connection string arrives through configuration rather than by swapping the registered
/// <c>DbContext</c> for a fake. That keeps the host under test identical to the deployed one: the
/// same <c>AddFreshlinePersistence</c> call runs, against the same provider, over a schema built
/// from the committed migrations. A test that replaced the database with an in-memory provider
/// would stop exercising the thing most likely to be wrong.</para>
/// </summary>
internal sealed class FreshlineApiFactory(string connectionString) : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");

        // UseSetting rather than ConfigureAppConfiguration, and the difference is a real one.
        //
        // Program.cs is top-level statements, so `WebApplication.CreateBuilder(args)` builds its
        // configuration and `AddFreshlinePersistence` reads the connection string out of it during
        // the first few lines of Main. A source added through ConfigureAppConfiguration is not
        // applied until the host is built, which is after that has already happened and thrown.
        // UseSetting writes into host configuration, which `builder.Configuration` includes from
        // the moment it exists.
        builder.UseSetting("ConnectionStrings:Freshline", connectionString);
    }
}
