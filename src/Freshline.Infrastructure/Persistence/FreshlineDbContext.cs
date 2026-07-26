using Freshline.Core.Model;
using Microsoft.EntityFrameworkCore;

namespace Freshline.Infrastructure.Persistence;

public class FreshlineDbContext(DbContextOptions<FreshlineDbContext> options) : DbContext(options)
{
    public DbSet<Establishment> Establishments => Set<Establishment>();

    public DbSet<Inspection> Inspections => Set<Inspection>();

    public DbSet<Violation> Violations => Set<Violation>();

    public DbSet<SourceRecord> SourceRecords => Set<SourceRecord>();

    public DbSet<SourceWatermark> SourceWatermarks => Set<SourceWatermark>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(FreshlineDbContext).Assembly);
    }
}
