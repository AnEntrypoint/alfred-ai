import { AuthenticationManager } from './auth-manager.js';

const auth = new AuthenticationManager();

auth.getAuthentication()
  .then(token => {
    if (token) {
      console.log('✅ SUCCESS: Token found:', token.substring(0, 50) + '...');
    } else {
      console.log('❌ No token found');
    }
  })
  .catch(err => {
    console.log('ERROR:', err.message);
  });