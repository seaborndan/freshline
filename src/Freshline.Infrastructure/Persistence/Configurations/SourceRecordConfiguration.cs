using Freshline.Core.Model;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Freshline.Infrastructure.Persistence.Configurations;

public class SourceRecordConfiguration : IEntityTypeConfiguration<SourceRecord>
{
    public void Configure(EntityTypeBuilder<SourceRecord> builder)
    {
        builder.ToTable("SourceRecords");

        builder.HasKey(r => r.Id);

        builder.Property(r => r.SourceId).HasConversion<int>();

        builder.Property(r => r.ExternalId).HasMaxLength(ColumnWidths.ExternalId).IsRequired();

        // The retained payload is deliberately unbounded. Capping it would mean a source that
        // added a field could silently truncate the very thing kept for re-normalising later.
        builder.Property(r => r.Payload).IsRequired();

        // The natural key, and the reason re-running a window updates rather than duplicates.
        builder
            .HasIndex(r => new { r.SourceId, r.ExternalId })
            .IsUnique()
            .HasDatabaseName("UX_SourceRecords_SourceId_ExternalId");
    }
}
