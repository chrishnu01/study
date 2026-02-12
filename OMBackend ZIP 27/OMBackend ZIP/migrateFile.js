const mongoose = require("mongoose");

(async () => {
    try {
        // connect to MongoDB
        // await mongoose.connect("mongodb://mangal:mangal2025@65.1.231.102:27017/admin", {
        await mongoose.connect("mongodb://om:omsacffolding2025@65.0.238.34:27017/caseTracker?authSource=admin", {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log("✅ Connected to MongoDB");

        const db = mongoose.connection.db;
        const collection = db.collection("leadorders"); // your actual collection name

        // Find leads where quotation is an object (not array and not null)
        const leadsToUpdate = await collection
            .find({
                quotation: { $exists: true, $type: "object" },
            })
            .toArray();

        console.log(`📦 Found ${leadsToUpdate.length} leads to update`);

        for (const lead of leadsToUpdate) {
            const quotation = lead.quotation;

            // Ensure we only modify plain objects, not already arrays or nulls
            if (quotation && !Array.isArray(quotation)) {
                const newQuotationId = new mongoose.Types.ObjectId();

                // Determine updatedAt (if missing, use current date)
                const quotationUpdatedAt =
                    quotation.updatedAt ? new Date(quotation.updatedAt) : new Date();

                // Wrap in an array with _id and updatedAt
                const newQuotationArray = [
                    {
                        _id: newQuotationId,
                        updatedAt: quotationUpdatedAt,
                        ...quotation,
                    },
                ];

                // Update both quotation and lead.updatedAt
                await collection.updateOne(
                    { _id: lead._id },
                    {
                        $set: {
                            quotation: newQuotationArray,
                            updatedAt: quotationUpdatedAt, // sync lead's updatedAt
                        },
                    }
                );

                console.log(`✅ Updated Lead ID: ${lead._id} (updatedAt: ${quotationUpdatedAt.toISOString()})`);
            }
        }

        console.log("🎉 Migration complete!");
        process.exit(0);
    } catch (err) {
        console.error("❌ Migration error:", err);
        process.exit(1);
    }
})();




// const mongoose = require("mongoose");

// (async () => {
//     try {
//         // connect to MongoDB
//         await mongoose.connect("mongodb://mangal:mangal2025@65.1.231.102:27017/admin", {
//             useNewUrlParser: true,
//             useUnifiedTopology: true,
//         });
//         console.log("✅ Connected to MongoDB");

//         const db = mongoose.connection.db;
//         const collection = db.collection("leadorders"); // your actual collection name

//         // Find leads where quotation is an object (not array and not null)
//         const leadsToUpdate = await collection
//             .find({
//                 quotation: { $exists: true, $type: "object" },
//             })
//             .toArray();

//         console.log(`📦 Found ${leadsToUpdate.length} leads to update`);

//         for (const lead of leadsToUpdate) {
//             const quotation = lead.quotation;

//             // Ensure we only modify plain objects, not already arrays or nulls
//             if (quotation && !Array.isArray(quotation)) {
//                 // Wrap in an array and ensure _id exists for each quotation
//                 const newQuotationArray = [
//                     {
//                         _id: new mongoose.Types.ObjectId(),
//                         ...quotation,
//                     },
//                 ];

//                 await collection.updateOne(
//                     { _id: lead._id },
//                     { $set: { quotation: newQuotationArray } }
//                 );

//                 console.log(`✅ Updated Lead ID: ${lead._id}`);
//             }
//         }

//         console.log("🎉 Migration complete!");
//         process.exit(0);
//     } catch (err) {
//         console.error("❌ Migration error:", err);
//         process.exit(1);
//     }
// })();
