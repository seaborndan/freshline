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

        // Every incremental run asks "what has happened since the watermark", and the scoring
        // model asks "what are this establishment's last few inspections". Both are this index.
        builder
            .HasIndex(i => new { i.EstablishmentId, i.InspectedOn })
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
