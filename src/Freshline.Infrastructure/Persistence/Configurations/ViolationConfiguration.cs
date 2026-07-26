using Freshline.Core.Model;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Freshline.Infrastructure.Persistence.Configurations;

public class ViolationConfiguration : IEntityTypeConfiguration<Violation>
{
    public void Configure(EntityTypeBuilder<Violation> builder)
    {
        builder.ToTable("Violations");

        builder.HasKey(v => v.Id);

        builder.Property(v => v.SourceId).HasConversion<int>();

        builder.Property(v => v.ExternalId).HasMaxLength(ColumnWidths.ExternalId).IsRequired();
        builder.Property(v => v.Code).HasMaxLength(ColumnWidths.ViolationCode).IsRequired();
        builder.Property(v => v.Description).HasMaxLength(ColumnWidths.ViolationDescription);

        builder
            .HasIndex(v => new { v.SourceId, v.ExternalId })
            .IsUnique()
            .HasDatabaseName("UX_Violations_SourceId_ExternalId");

        // "Which establishments in my territory picked up an 04L this month" is the product's
        // central question, and it filters on the code. Never on the description — see the note
        // on Violation.Description for why that search returns a confident zero.
        builder
            .HasIndex(v => new { v.SourceId, v.Code })
            .HasDatabaseName("IX_Violations_SourceId_Code");

        builder
            .HasOne(v => v.SourceRecord)
            .WithMany()
            .HasForeignKey(v => v.SourceRecordId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
