// En tu archivo firebase.ts o similar
import { getAuth, signInAnonymously } from "firebase/auth";
import { ref, set } from "firebase/database";
import { getDatabase } from "firebase/database";

const auth = getAuth(app);
const database = getDatabase(app);

async function signInAndSaveTelegramUser(telegramUser: any) {
  try {
    const userCredential = await signInAnonymously(auth);
    const firebaseUid = userCredential.user.uid;

    // Guarda la información del usuario de Telegram en Realtime Database
    await set(ref(database, 'users/' + firebaseUid), {
      telegramId: telegramUser.id,
      firstName: telegramUser.first_name,
      lastName: telegramUser.last_name || '',
      username: telegramUser.username || '',
      photoUrl: telegramUser.photo_url || '',
      // Otros datos específicos del juego como victorias/derrotas
    });
    console.log("Usuario Firebase autenticado y datos de Telegram guardados:", firebaseUid);
    return firebaseUid;
  } catch (error) {
    console.error("Error al autenticar o guardar usuario de Telegram:", error);
  }
}

// Cuando tu mini web app carga y obtienes los datos del usuario de Telegram
// const telegramUser = window.Telegram.WebApp.initDataUnsafe.user; // Ejemplo de cómo obtenerlo
// signInAndSaveTelegramUser(telegramUser);
