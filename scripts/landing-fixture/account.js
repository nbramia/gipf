// Synthetic browser boundary only. Never imported by the production application.
export const loadSession = () => JSON.parse(sessionStorage.getItem('fixture-account') || 'null');
export const deriveCredentials = async username => ({ username, usernameId: 'fixture', authToken: 'fixture', aesKey: 'fixture' });
export const encryptApiKey = async () => 'fixture-ciphertext';
export const decryptApiKey = async () => 'fixture-key';
export const getSharedApiKey = () => '';
export const getSharedLichessToken = () => '';
export const createAccount = async () => ({});
export const loginAccount = async () => sessionStorage.getItem('fixture-error') ? { error: 'bad_credentials' } : {};
export const saveSession = async (creds, options) => {
  sessionStorage.setItem('fixture-account', JSON.stringify(creds));
  sessionStorage.setItem('fixture-import', String(options.importGuest));
};
export const clearSession = async () => sessionStorage.removeItem('fixture-account');
