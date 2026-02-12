const mongoose = require("mongoose");

const sourceSchema = new mongoose.Schema(
    {
        addedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        sourceName: [{
            type: String,
        }],

        referenceName: [{
            type: String,
        }],

        timeline: {
            type: [
                {
                    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
                    changes: [
                        {
                            field: String,
                            oldValue: String,
                            newValue: String,
                        },
                    ],
                    updatedAt: { type: Date, default: Date.now },
                },
            ],
            default: [],
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model("Source", sourceSchema);
