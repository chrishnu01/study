const mongoose = require("mongoose");

const unitsSchema = new mongoose.Schema(
    {
        addedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        units: {
            type: String,
        },

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
    { timestamps: true }
);

module.exports = mongoose.model("unit", unitsSchema);
