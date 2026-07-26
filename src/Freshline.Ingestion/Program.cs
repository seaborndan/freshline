using Freshline.Infrastructure.DependencyInjection;
using Freshline.Infrastructure.Persistence;
using Freshline.Ingestion;
using Microsoft.EntityFrameworkCore;

var builder = Host.CreateApplicationBuilder(args);

builder.Services
    .AddOptions<IngestionScheduleOptions>()
    .Bind(builder.Configuration.GetSection(IngestionScheduleOptions.SectionName))
    .ValidateDataAnnotations()
    .ValidateOnStart();

builder.Services.AddFreshlineInfrastructure(builder.Configuration);
builder.Services.AddHostedService<Worker>();

var host = builder.Build();

// Off by default; see IngestionScheduleOptions.ApplyMigrationsOnStartup for why a deployed
// worker should not be the thing that changes the schema.
var schedule = host.Services.GetRequiredService<Microsoft.Extensions.Options.IOptions<IngestionScheduleOptions>>();
if (schedule.Value.ApplyMigrationsOnStartup)
{
    using var scope = host.Services.CreateScope();
    var dbContext = scope.ServiceProvider.GetRequiredService<FreshlineDbContext>();
    await dbContext.Database.MigrateAsync();
}

host.Run();
