const express = require('express')
const router = express.Router()

router.use('/api', require('./userRoutes'))
router.use('/api/app', require('./userAppRoutes'))

module.exports = router
