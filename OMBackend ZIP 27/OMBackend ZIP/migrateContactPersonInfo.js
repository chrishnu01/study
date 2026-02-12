const mongoose = require("mongoose");
const LeadOrder = require("./models/Case"); // adjust path as needed

(async () => {
    try {
        await mongoose.connect("mongodb://om:omsacffolding2025@65.0.238.34:27017/caseTracker?authSource=admin", {
            // await mongoose.connect("mongodb://stagingom:stagingom2026@35.154.172.177:27017/?authSource=admin", {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log("✅ Connected to MongoDB");

        // Fetch all leads
        const leads = await LeadOrder.find({});
        console.log(`📦 Found ${leads.length} leads to process...\n`);

        let updatedCount = 0;

        for (const lead of leads) {
            if (!lead.lead) continue;

            const { contactPersonName, contactPersonEmail, contactPersonPhone } = lead.lead || {};

            // Skip if no data to add
            if (
                !contactPersonName &&
                !contactPersonEmail &&
                (!contactPersonPhone || contactPersonPhone.length === 0)
            ) {
                continue;
            }

            // Ensure contactPersonInfo array exists
            if (!Array.isArray(lead.lead.contactPersonInfo)) {
                lead.lead.contactPersonInfo = [];
            }

            // 1️⃣ Remove empty placeholder entries
            const beforeCount = lead.lead.contactPersonInfo.length;

            lead.lead.contactPersonInfo = lead.lead.contactPersonInfo.filter(
                (info) =>
                    info.contactPersonName?.trim() !== "" ||
                    info.contactPersonEmail?.trim() !== "" ||
                    (Array.isArray(info.contactPersonPhone) && info.contactPersonPhone.length > 0)
            );

            const afterCount = lead.lead.contactPersonInfo.length;
            const removedCount = beforeCount - afterCount;

            // 2️⃣ Add the new current individual data as a new contact
            lead.lead.contactPersonInfo.push({
                contactPersonName: contactPersonName || "",
                contactPersonEmail: contactPersonEmail || "",
                contactPersonPhone: contactPersonPhone || [],
            });

            await lead.save();
            updatedCount++;

            console.log(`✅ Updated Lead: ${lead._id} | 🧹 Removed ${removedCount} empty | Total contacts now: ${lead.lead.contactPersonInfo.length}`);
        }

        console.log(`\n🎯 Migration complete. ${updatedCount} leads updated.`);
        process.exit(0);
    } catch (err) {
        console.error("❌ Migration failed:", err);
        process.exit(1);
    }
})();



// const mongoose = require("mongoose");
// const LeadOrder = require("./models/Case"); // adjust path as needed

// (async () => {
//     try {
//         await mongoose.connect("mongodb://stagingom:stagingom2026@35.154.172.177:27017/?authSource=admin", {
//             useNewUrlParser: true,
//             useUnifiedTopology: true,
//         });
//         console.log("✅ Connected to MongoDB");

//         // Find one lead by ID (change this to test)
//         const lead = await LeadOrder.findById("694a7b55268c01c02d78c263");
//         if (!lead) {
//             console.log("❌ Lead not found");
//             return process.exit(0);
//         }

//         const { contactPersonName, contactPersonEmail, contactPersonPhone } = lead.lead || {};

//         // Skip if no data to add
//         if (
//             !contactPersonName &&
//             !contactPersonEmail &&
//             (!contactPersonPhone || contactPersonPhone.length === 0)
//         ) {
//             console.log("⚠️ No contact details found to add for this lead");
//             return process.exit(0);
//         }

//         // Ensure contactPersonInfo array exists
//         if (!Array.isArray(lead.lead.contactPersonInfo)) {
//             lead.lead.contactPersonInfo = [];
//         }

//         // 1️⃣ Remove empty placeholder entries
//         const beforeCount = lead.lead.contactPersonInfo.length;

//         lead.lead.contactPersonInfo = lead.lead.contactPersonInfo.filter(
//             (info) =>
//                 info.contactPersonName?.trim() !== "" ||
//                 info.contactPersonEmail?.trim() !== "" ||
//                 (Array.isArray(info.contactPersonPhone) && info.contactPersonPhone.length > 0)
//         );

//         const afterCount = lead.lead.contactPersonInfo.length;
//         const removedCount = beforeCount - afterCount;

//         // 2️⃣ Add the new current individual data as a new contact
//         lead.lead.contactPersonInfo.push({
//             contactPersonName: contactPersonName || "",
//             contactPersonEmail: contactPersonEmail || "",
//             contactPersonPhone: contactPersonPhone || [],
//         });

//         await lead.save();

//         console.log(`✅ Lead updated successfully: ${lead._id}`);
//         console.log(`🧹 Removed ${removedCount} empty contact entries`);
//         console.log("📄 Updated contactPersonInfo:", lead.lead.contactPersonInfo);

//         process.exit(0);
//     } catch (err) {
//         console.error("❌ Migration failed:", err);
//         process.exit(1);
//     }
// })();




// const mongoose = require("mongoose");
// const LeadOrder = require("./models/Case"); // adjust path as needed

// (async () => {
//     try {
//         await mongoose.connect("mongodb://stagingom:stagingom2026@35.154.172.177:27017/?authSource=admin", {
//             useNewUrlParser: true,
//             useUnifiedTopology: true,
//         });
//         console.log("✅ Connected to MongoDB");

//         // Find one specific lead by _id
//         const lead = await LeadOrder.findById("694f6a185c2cdc6a9562ed46");
//         if (!lead) {
//             console.log("❌ Lead not found");
//             return process.exit(0);
//         }

//         const { contactPersonName, contactPersonEmail, contactPersonPhone } = lead.lead || {};

//         if (
//             !contactPersonName &&
//             !contactPersonEmail &&
//             (!contactPersonPhone || contactPersonPhone.length === 0)
//         ) {
//             console.log("⚠️ No contact details to migrate for this lead");
//             return process.exit(0);
//         }

//         if (!Array.isArray(lead.lead.contactPersonInfo)) {
//             lead.lead.contactPersonInfo = [];
//         }

//         // Always add new entry
//         lead.lead.contactPersonInfo.push({
//             contactPersonName: contactPersonName || "",
//             contactPersonEmail: contactPersonEmail || "",
//             contactPersonPhone: contactPersonPhone || [],
//         });

//         await lead.save();
//         console.log(`✅ Successfully added contact to Lead ID: ${lead._id}`);

//         // Print the updated lead for verification
//         console.log("Updated contactPersonInfo:", lead.lead.contactPersonInfo);

//         process.exit(0);
//     } catch (err) {
//         console.error("❌ Migration failed:", err);
//         process.exit(1);
//     }
// })();



// const mongoose = require("mongoose");
// const LeadOrder = require("./models/LeadOrder"); // adjust path as needed

// (async () => {
//     try {
//         await mongoose.connect("mongodb://localhost:27017/YOUR_DB_NAME", {
//             useNewUrlParser: true,
//             useUnifiedTopology: true,
//         });
//         console.log("✅ Connected to MongoDB");

//         const leads = await LeadOrder.find({});
//         console.log(`Found ${leads.length} leads to process...`);

//         for (const lead of leads) {
//             const { contactPersonName, contactPersonEmail, contactPersonPhone } = lead.lead || {};

//             // Skip only if all fields are empty
//             if (
//                 !contactPersonName &&
//                 !contactPersonEmail &&
//                 (!contactPersonPhone || contactPersonPhone.length === 0)
//             ) {
//                 continue;
//             }

//             // Ensure contactPersonInfo is initialized
//             if (!Array.isArray(lead.lead.contactPersonInfo)) {
//                 lead.lead.contactPersonInfo = [];
//             }

//             // Always push the individual contact as a new entry
//             lead.lead.contactPersonInfo.push({
//                 contactPersonName: contactPersonName || "",
//                 contactPersonEmail: contactPersonEmail || "",
//                 contactPersonPhone: contactPersonPhone || [],
//             });

//             await lead.save();
//             console.log(`✅ Added contact to Lead ID: ${lead._id}`);
//         }

//         console.log("🎯 Migration complete!");
//         process.exit(0);
//     } catch (err) {
//         console.error("❌ Migration failed:", err);
//         process.exit(1);
//     }
// })();
