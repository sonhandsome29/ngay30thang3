const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    from: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'user',
      required: true
    },
    to: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'user',
      required: true
    },
    contentMessage: {
      type: {
        type: String,
        enum: ['file', 'text'],
        required: true
      },
      content: {
        type: String,
        required: true,
        trim: true
      }
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('message', messageSchema);
