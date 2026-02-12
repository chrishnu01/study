// helpers/getNextSequence.js
const Counter = require("../models/Counter");

async function getNextSequence(name = "quotationFileNumber", incrementBy = 1) {
    const counter = await Counter.findOneAndUpdate(
        { name },
        { $inc: { seq: incrementBy } },
        { new: true, upsert: true }
    );

    const end = counter.seq;
    const start = end - incrementBy + 1;
    return { start, end };
}

module.exports = getNextSequence;
