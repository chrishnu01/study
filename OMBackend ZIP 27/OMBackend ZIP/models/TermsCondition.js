const mongoose = require("mongoose");

const termConditionSchema = new mongoose.Schema(
    {
        list: {
            type: String,
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model("TermCondition", termConditionSchema);
