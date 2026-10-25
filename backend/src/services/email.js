const nodemailer = require('nodemailer');
const { frontendUrl, smtp } = require('../config/env');

function isEmailConfigured() {
  const authenticationIsComplete = Boolean(smtp.user) === Boolean(smtp.password);
  return Boolean(smtp.host && smtp.from && authenticationIsComplete);
}

async function sendPasswordResetEmail(email, token) {
  if (!isEmailConfigured()) {
    throw new Error('Password reset email is not configured.');
  }
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.password } } : {}),
  });
  const resetUrl = new URL('/reset-password', frontendUrl);
  resetUrl.searchParams.set('token', token);
  await transporter.sendMail({
    from: smtp.from,
    to: email,
    subject: 'Reset your Signal CMS password',
    text: `Use this link to reset your Signal CMS password. The link expires in one hour and can only be used once:\n\n${resetUrl.toString()}\n\nIf you did not request a reset, you can ignore this email.`,
    html: `<p>Use the link below to reset your Signal CMS password. It expires in one hour and can only be used once.</p><p><a href="${resetUrl.toString()}">Reset password</a></p><p>If you did not request a reset, you can ignore this email.</p>`,
  });
}

module.exports = { isEmailConfigured, sendPasswordResetEmail };
