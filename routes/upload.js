var express = require("express");
var router = express.Router();
let upload = require('../utils/uploadHandler')
let path = require('path')

router.post('/single', upload.single('file'), function (req, res, next) {
    if (!req.file) {
        res.status(404).send({
            message: "file not found"
        })
    }
    res.send({
        filename: req.file.filename,
        path: req.file.path,
        size: req.file.size
    })
})
router.post('/multiple', upload.array('files', 5), function (req, res, next) {
    if (!req.files) {
        res.status(404).send({
            message: "file not found"
        })
    }
    console.log(req.files);
    let filesInfor = req.files.map(e => {
        return {
            filename: e.filename,
            path: e.path,
            size: e.size
        }
    })
    res.send(filesInfor)
})
router.get('/:filename', function (req, res, next) {
    let pathFile = path.join(__dirname, '../uploads', req.params.filename)
    res.sendFile(pathFile)
})

module.exports = router;