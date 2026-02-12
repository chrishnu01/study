require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const route = require('./Routes/indexRoutes')

const app = express();
connectDB();

app.use(cors());
app.use(express.json());

app.use('/', route);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
