const express = require('express');
const managerAppController = require('../controllers/userAppController');
const userAppToken = require('../middleware/userAppToken');
const multer = require('multer');

const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
});

const router = express.Router();

// Multiple file fields (extend as needed)
const uploadFields = upload.fields([
    { name: "media", maxCount: 10 },
]);

// ****************************************************************USER API's**************************************************************************
router.post('/userLogin', managerAppController.userLogin);
router.get('/getUser', userAppToken, managerAppController.getUser);
router.put('/updatePassword', userAppToken, managerAppController.updatePassword);
router.put('/updateUser', userAppToken, managerAppController.updateUser);
router.put('/deleteAccount', userAppToken, managerAppController.deleteAccount);

// ****************************************************************LEAD API's**************************************************************************
router.get('/getAllLeads', userAppToken, managerAppController.getAllLeads);
router.get('/getCustomerLeads', userAppToken, managerAppController.getCustomerLeads);
router.get('/getLeadAndCustomers', userAppToken, managerAppController.getLeadAndCustomers);

router.post('/punch', userAppToken, uploadFields, managerAppController.punchIn);
router.post('/addRemark/:id', userAppToken, uploadFields, managerAppController.addVisitRemark);
router.get('/loginStatus', userAppToken, managerAppController.getLoginStatus);


module.exports = router;