// remove-self-allotted-leads.js
const mongoose = require("mongoose");
const LeadOrder = require("./models/Case"); // adjust path as needed

const MONGO_URI = "mongodb://om:omsacffolding2025@65.0.238.34:27017/caseTracker?authSource=admin";

(async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log("✅ Connected to MongoDB");

        // Fetch leads where leadAllotedTo is not empty
        const leads = await LeadOrder.find({
            leadAllotedTo: { $exists: true, $ne: [] },
        });

        console.log(`🔍 Found ${leads.length} leads with assigned users`);

        let updatedCount = 0;

        for (const lead of leads) {
            if (!lead.addedBy) continue;

            const addedById = lead.addedBy.toString();
            const originalLength = lead.leadAllotedTo.length;

            // Filter out entries where leadAllotedTo.user === addedById
            lead.leadAllotedTo = lead.leadAllotedTo.filter(
                (entry) => entry.user?.toString() !== addedById
            );

            if (lead.leadAllotedTo.length !== originalLength) {
                await lead.save();
                updatedCount++;
                console.log(
                    `🧹 Cleaned lead: ${lead._id} (removed self-allotment for user ${addedById})`
                );
            }
        }

        console.log(`✅ Migration completed. Updated ${updatedCount} leads.`);
        process.exit(0);
    } catch (err) {
        console.error("❌ Migration failed:", err);
        process.exit(1);
    }
})();
