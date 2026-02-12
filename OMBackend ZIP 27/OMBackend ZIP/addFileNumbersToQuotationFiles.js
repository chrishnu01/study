const mongoose = require("mongoose");
const LeadOrder = require("./models/Case");
const Counter = require("./models/Counter");

const MONGO_URI = "mongodb://om:omsacffolding2025@65.0.238.34:27017/caseTracker?authSource=admin";

(async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB");

    let globalCounter = 0;

    // Fetch all leads that have at least one quotation file
    const leads = await LeadOrder.find({
      "quotation.quotationFiles.0": { $exists: true },
    }).lean(); // use lean() to get plain JS objects
    console.log(`Found ${leads.length} leads with quotation files`);

    for (const lead of leads) {
      if (!Array.isArray(lead.quotation)) continue;

      let leadNeedsUpdate = false;
      const updatedQuotations = [];

      for (const [qIndex, quotation] of lead.quotation.entries()) {
        if (!quotation.quotationFiles || quotation.quotationFiles.length === 0) {
          updatedQuotations.push(quotation);
          continue;
        }

        const updatedFiles = quotation.quotationFiles.map((file) => {
          globalCounter++;

          if (typeof file === "string") {
            return { fileUrl: file, fileNumber: globalCounter };
          } else if (file.fileUrl && !file.fileNumber) {
            return { ...file, fileNumber: globalCounter };
          } else if (file._id && !file.fileUrl) {
            // case where _id placeholder exists — skip
            return file;
          } else {
            return file;
          }
        });

        // Detect if files were plain strings before
        const hadStringFiles = quotation.quotationFiles.some(
          (f) => typeof f === "string"
        );

        if (hadStringFiles) {
          leadNeedsUpdate = true;
          updatedQuotations.push({
            ...quotation,
            quotationFiles: updatedFiles,
          });
          console.log(
            `✅ Updated Quotation ${qIndex + 1} for Lead ${lead._id} (${updatedFiles.length} files)`
          );
        } else {
          updatedQuotations.push(quotation);
        }
      }

      if (leadNeedsUpdate) {
        await LeadOrder.updateOne(
          { _id: lead._id },
          { $set: { quotation: updatedQuotations } }
        );
        console.log(`💾 Saved Lead ${lead._id}`);
      } else {
        console.log(`ℹ️ No update needed for Lead ${lead._id}`);
      }
    }

    // Update global counter
    await Counter.findOneAndUpdate(
      { name: "quotationFileNumber" },
      { seq: globalCounter },
      { upsert: true, new: true }
    );

    console.log(`🎉 Migration complete! Last file number = ${globalCounter}`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  }
})();
