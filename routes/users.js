var express = require("express");
var router = express.Router();
let bcrypt = require('bcrypt')
let multer = require('multer')
let xlsx = require('xlsx')
let crypto = require('crypto')
let { userPostValidation, validateResult } =
  require('../utils/validationHandler')
let { checkLogin, checkRole } = require('../utils/authHandler')
let userModel = require('../schemas/users');
let cartModel = require('../schemas/carts')
let roleModel = require('../schemas/roles')
let { sendPasswordMail } = require('../utils/mailHandler')
let mongoose = require('mongoose')

let userController = require("../controllers/users");

const EXCEL_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream'
])

const DEFAULT_ROLE_ID = '69a4f929f8d941f2dd234b88'

let excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: function (req, file, cb) {
    let extension = (file.originalname || '').toLowerCase();
    let isExcelFile = extension.endsWith('.xlsx') || extension.endsWith('.xls');
    if (isExcelFile || EXCEL_MIME_TYPES.has(file.mimetype)) {
      cb(null, true)
      return;
    }
    cb(new Error('file phai la dinh dang excel'));
  }
})

function generateRandomPassword(length) {
  let size = length || 16;
  let chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=';
  let output = '';
  let randomBytes = crypto.randomBytes(size * 2);

  for (let i = 0; output.length < size && i < randomBytes.length; i++) {
    output += chars[randomBytes[i] % chars.length];
  }

  while (output.length < size) {
    output += chars[crypto.randomInt(0, chars.length)];
  }

  return output;
}

function readField(row, expectedKey) {
  let keys = Object.keys(row || {});
  for (let key of keys) {
    if (String(key).trim().toLowerCase() === expectedKey) {
      return String(row[key] || '').trim();
    }
  }
  return '';
}

function readUsersFromExcelBuffer(fileBuffer) {
  let workbook = xlsx.read(fileBuffer, { type: 'buffer' });
  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    return [];
  }

  let firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  let rows = xlsx.utils.sheet_to_json(firstSheet, { defval: '' });

  return rows.map(function (row, index) {
    return {
      rowNumber: index + 2,
      username: readField(row, 'username'),
      email: readField(row, 'email')
    }
  });
}

async function findDefaultRoleId() {
  let role = await roleModel.findOne({
    isDeleted: false,
    name: /^user$/i
  });

  if (!role) {
    role = await roleModel.findOne({ isDeleted: false });
  }

  if (role) {
    return role._id;
  }

  return DEFAULT_ROLE_ID;
}

function isEmailValid(email) {
  return /^\S+@\S+\.\S+$/.test(email);
}

async function sendPasswordMailsInBatches(mailJobs, report) {
  let delayBetweenMails = 1200;
  for (let job of mailJobs) {
    let lastError = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await sendPasswordMail(job.email, job.username, job.password)
        report.mailed += 1;
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        let isRateLimited = String(error.message || '').includes('Too many emails per second');
        if (isRateLimited && attempt === 0) {
          await new Promise(function (resolve) {
            setTimeout(resolve, 2000)
          })
          continue;
        }
      }
    }

    if (lastError) {
      report.errors.push({
        row: job.rowNumber,
        username: job.username,
        email: job.email,
        message: 'tao user thanh cong, gui mail that bai: ' + lastError.message
      })
    }

    await new Promise(function (resolve) {
      setTimeout(resolve, delayBetweenMails)
    })
  }
}


router.get("/", checkLogin, checkRole("ADMIN"), async function (req, res, next) {
  let result = await userController.getAllUser();
  res.send(result)
});

router.get("/:id", checkLogin, checkRole("ADMIN", "MODERATOR"), async function (req, res, next) {
  try {
    let result = await userController.FindByID(req.params.id)
    if (result) {
      res.send(result);
    }
    else {
      res.status(404).send({ message: "id not found" });
    }
  } catch (error) {
    res.status(404).send({ message: "id not found" });
  }
});

router.post("/", userPostValidation, validateResult,
  async function (req, res, next) {
    let session = await mongoose.startSession();
    let transaction = session.startTransaction()
    try {
      let newItem = await userController.CreateAnUser(
        req.body.username,
        req.body.password,
        req.body.email,
        req.body.role,
        "", "",
        false,
        session
      )
      let newCart = new cartModel({
        user: newItem._id
      })
      newCart = await newCart.save({ session })
      await newCart.populate('user')
      session.commitTransaction()
      session.endSession()
      res.send(newCart)
    } catch (err) {
      session.abortTransaction();
      session.endSession()
      res.status(400).send({ message: err.message });
    }
  });

router.post('/import', excelUpload.single('file'), async function (req, res, next) {
  try {
    if (!req.file || !req.file.buffer) {
      res.status(400).send({
        message: 'khong tim thay file'
      })
      return;
    }

    let rows = readUsersFromExcelBuffer(req.file.buffer);
    if (rows.length === 0) {
      res.status(400).send({
        message: 'file khong co du lieu username, email'
      })
      return;
    }

    let roleId = await findDefaultRoleId();
    let report = {
      total: rows.length,
      imported: 0,
      mailed: 0,
      skipped: 0,
      errors: []
    }

    let mailJobs = []

    for (let row of rows) {
      try {
        if (!row.username || !row.email) {
          throw new Error('thieu username hoac email');
        }

        if (!isEmailValid(row.email)) {
          throw new Error('email khong hop le');
        }

        let existedUser = await userModel.findOne({
          $or: [
            { username: row.username },
            { email: row.email }
          ]
        });

        if (existedUser) {
          throw new Error('username hoac email da ton tai');
        }

        let password = generateRandomPassword(16);
        let createdUser = new userModel({
          username: row.username,
          password: password,
          email: row.email,
          role: roleId,
          fullName: '',
          avatarUrl: '',
          status: false
        });

        await createdUser.save();
        report.imported += 1;

        mailJobs.push({
          rowNumber: row.rowNumber,
          username: row.username,
          email: row.email,
          password: password
        })
      } catch (error) {
        report.skipped += 1;
        report.errors.push({
          row: row.rowNumber,
          username: row.username,
          email: row.email,
          message: error.message
        })
      }
    }

    await sendPasswordMailsInBatches(mailJobs, report);

    res.send(report)
  } catch (error) {
    res.status(400).send({
      message: error.message
    })
  }
})

router.put("/:id", async function (req, res, next) {
  try {
    let id = req.params.id;
    let updatedItem = await userModel.findOne({ _id: id, isDeleted: false })
    if (!updatedItem) return res.status(404).send({ message: "id not found" });
    let keys = Object.keys(req.body);
    for (const key of keys) {
      updatedItem[key] = req.body[key];
    }
    await updatedItem.save();
    let populated = await userModel
      .findById(updatedItem._id)
    res.send(populated);
  } catch (err) {
    res.status(400).send({ message: err.message });
  }
});
router.delete("/:id", async function (req, res, next) {
  try {
    let id = req.params.id;
    let updatedItem = await userModel.findByIdAndUpdate(
      id,
      { isDeleted: true },
      { new: true }
    );
    if (!updatedItem) {
      return res.status(404).send({ message: "id not found" });
    }
    res.send(updatedItem);
  } catch (err) {
    res.status(400).send({ message: err.message });
  }
});

module.exports = router;
