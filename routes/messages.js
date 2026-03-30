var express = require('express');
var router = express.Router();
let mongoose = require('mongoose');
let messageModel = require('../schemas/messages');
let userModel = require('../schemas/users');
let { checkLogin } = require('../utils/authHandler');

function isValidUrl(value) {
  try {
    let parsedUrl = new URL(value);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

function isValidMessageBody(body) {
  if (!body || !body.contentMessage) {
    return 'thieu contentMessage';
  }

  let { type, content } = body.contentMessage;
  if (!['file', 'text'].includes(type)) {
    return 'type phai la file hoac text';
  }

  if (!content || typeof content !== 'string' || !content.trim()) {
    return 'content khong hop le';
  }

  if (type === 'file' && !isValidUrl(content.trim())) {
    return 'content phai la url khi type la file';
  }

  return null;
}

router.get('/', checkLogin, async function (req, res, next) {
  try {
    let currentUserId = new mongoose.Types.ObjectId(req.userId);
    let messages = await messageModel.aggregate([
      {
        $match: {
          $or: [
            { from: currentUserId },
            { to: currentUserId }
          ]
        }
      },
      {
        $addFields: {
          conversationUser: {
            $cond: [
              { $eq: ['$from', currentUserId] },
              '$to',
              '$from'
            ]
          }
        }
      },
      {
        $sort: {
          createdAt: -1,
          _id: -1
        }
      },
      {
        $group: {
          _id: '$conversationUser',
          lastMessage: { $first: '$$ROOT' }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      {
        $unwind: '$user'
      },
      {
        $project: {
          _id: 0,
          user: {
            _id: '$user._id',
            username: '$user.username',
            email: '$user.email',
            fullName: '$user.fullName',
            avatarUrl: '$user.avatarUrl'
          },
          lastMessage: '$lastMessage'
        }
      },
      {
        $sort: {
          'lastMessage.createdAt': -1,
          'lastMessage._id': -1
        }
      }
    ]);

    res.send(messages);
  } catch (error) {
    res.status(400).send({ message: error.message });
  }
});

router.get('/:userId', checkLogin, async function (req, res, next) {
  try {
    let currentUserId = req.userId;
    let targetUserId = req.params.userId;

    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      res.status(400).send({ message: 'userId khong hop le' });
      return;
    }

    let userExists = await userModel.exists({ _id: targetUserId, isDeleted: false });
    if (!userExists) {
      res.status(404).send({ message: 'khong tim thay user' });
      return;
    }

    let messages = await messageModel
      .find({
        $or: [
          { from: currentUserId, to: targetUserId },
          { from: targetUserId, to: currentUserId }
        ]
      })
      .populate('from', 'username email fullName avatarUrl')
      .populate('to', 'username email fullName avatarUrl')
      .sort({ createdAt: 1, _id: 1 });

    res.send(messages);
  } catch (error) {
    res.status(400).send({ message: error.message });
  }
});

router.post('/', checkLogin, async function (req, res, next) {
  try {
    let { to, contentMessage } = req.body;

    if (!mongoose.Types.ObjectId.isValid(to)) {
      res.status(400).send({ message: 'to khong hop le' });
      return;
    }

    if (String(to) === String(req.userId)) {
      res.status(400).send({ message: 'khong the gui tin nhan cho chinh minh' });
      return;
    }

    let bodyError = isValidMessageBody(req.body);
    if (bodyError) {
      res.status(400).send({ message: bodyError });
      return;
    }

    let targetUser = await userModel.exists({ _id: to, isDeleted: false });
    if (!targetUser) {
      res.status(404).send({ message: 'khong tim thay user nhan' });
      return;
    }

    let newMessage = new messageModel({
      from: req.userId,
      to: to,
      contentMessage: {
        type: contentMessage.type,
        content: contentMessage.content.trim()
      }
    });

    await newMessage.save();
    await newMessage.populate('from', 'username email fullName avatarUrl');
    await newMessage.populate('to', 'username email fullName avatarUrl');

    res.status(201).send(newMessage);
  } catch (error) {
    res.status(400).send({ message: error.message });
  }
});

module.exports = router;
