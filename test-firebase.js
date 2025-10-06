// test-firebase.js
require('dotenv').config();
const admin = require('firebase-admin');

// Initialize Firebase
try {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    }),
  });

  const db = admin.firestore();
  console.log('✅ Firebase connected successfully!');
  console.log('Project ID:', process.env.FIREBASE_PROJECT_ID);

  // Test writing to Firestore
  async function testFirestore() {
    try {
      await db.collection('test').add({
        message: 'Hello from ZoneTrain!',
        timestamp: new Date()
      });
      console.log('✅ Test document written to Firestore!');
      
      // Test reading from Firestore
      const snapshot = await db.collection('test').limit(1).get();
      console.log('✅ Test document read from Firestore!');
      console.log('Documents found:', snapshot.size);
      
      process.exit(0);
    } catch (error) {
      console.error('❌ Firestore test failed:', error);
      process.exit(1);
    }
  }

  testFirestore();

} catch (error) {
  console.error('❌ Firebase initialization failed:', error.message);
  console.log('\nCheck your .env file:');
  console.log('- FIREBASE_PROJECT_ID:', process.env.FIREBASE_PROJECT_ID ? '✅ Set' : '❌ Missing');
  console.log('- FIREBASE_PRIVATE_KEY:', process.env.FIREBASE_PRIVATE_KEY ? '✅ Set' : '❌ Missing');
  console.log('- FIREBASE_CLIENT_EMAIL:', process.env.FIREBASE_CLIENT_EMAIL ? '✅ Set' : '❌ Missing');
  process.exit(1);
}
