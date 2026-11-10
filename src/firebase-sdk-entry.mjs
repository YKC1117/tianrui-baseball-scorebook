// Build into a self-hosted static module; no CDN or paid backend required.
export {initializeApp,deleteApp} from 'firebase/app';
export {getAuth,setPersistence,browserSessionPersistence,inMemoryPersistence,signInWithEmailAndPassword,signOut,connectAuthEmulator} from 'firebase/auth';
export {initializeFirestore,memoryLocalCache,doc,collection,getDocFromServer,getDocsFromServer,runTransaction,writeBatch,serverTimestamp,Timestamp,connectFirestoreEmulator,terminate} from 'firebase/firestore';
