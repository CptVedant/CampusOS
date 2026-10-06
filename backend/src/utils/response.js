export const ok = (data = null) => ({ success: true, data });

export const fail = (code, message, details) => ({
  success: false,
  error: details === undefined ? { code, message } : { code, message, details },
});
