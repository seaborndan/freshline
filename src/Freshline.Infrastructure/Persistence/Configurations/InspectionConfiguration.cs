using Freshline.Core.Model;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Freshline.Infrastructure.Persistence.Configurations;

public class InspectionConfiguration : IEntityTypeConfiguration<Inspection>
{
    public void Configure(EntityTypeBuilder<Inspection> builder)
    {
        builder.ToTable("Inspections");

        builder.HasKey(i => i.Id);

        builder.Property(i => i.SourceId).HasConversion<int>();
        builder.Property(i => i.Outcome).HasConversion<int>();

        builder.Property(i => i.ExternalId).HasMaxLength(ColumnWidths.ExternalId).IsRequired();
        builder.Property(i => i.InspectionType).HasMaxLength(ColumnWidths.InspectionType);
        builder.Property(i => i.Action).HasMaxLength(ColumnWidths.Action);
        builder.Property(i => i.RawGrade).HasMaxLength(ColumnWidths.RawGrade);

        builder
            .HasIndex(i => new { i.SourceId, i.ExternalId })
            .IsUnique()
            .HasDatabaseName("UX_Inspections_SourceId_ExternalId");

        // The map's list query asks, for every establishment in view, "what was the most recent
        // inspection and how did it go". Three things make that cheap, and they were measured
        // rather than assumed — see docs/performance.md.
        //
        //   EstablishmentId  seeks straight to one establishment's inspections
        //   InspectedOn DESC puts the newest first, so TOP 1 stops after one row instead of
        //                    reading every inspection and sorting them
        //   INCLUDE          carries the two columns the query selects, so a matched row does not
        //                    then have to be fetched from the clustered index. Removing these two
        //                    key lookups took the query from 32,529 logical reads to 15,525.
        builder
            .HasIndex(i => new { i.EstablishmentId, i.InspectedOn })
            .IsDescending(false, true)
            .IncludeProperties(i => new { i.RawGrade, i.NormalisedSeverity })
            .HasDatabaseName("IX_Inspections_EstablishmentId_InspectedOn");

        builder
            .HasOne(i => i.SourceRecord)
            .WithMany()
            .HasForeignKey(i => i.SourceRecordId)
            .OnDelete(DeleteBehavior.Restrict);

        builder
            .HasMany(i => i.Violations)
            .WithOne(v => v.Inspection)
            .HasForeignKey(v => v.InspectionId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
