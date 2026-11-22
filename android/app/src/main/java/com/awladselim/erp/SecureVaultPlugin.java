package com.awladselim.erp;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "SecureVault")
public class SecureVaultPlugin extends Plugin {
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "awlad_selim_vault_master_v1";
    private static final String PREFS_NAME = "awlad_selim_secure_vault_v1";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_IV_LENGTH = 12;
    private static final int GCM_TAG_LENGTH_BITS = 128;

    private synchronized SecretKey getOrCreateSecretKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
        keyStore.load(null);

        if (keyStore.containsAlias(KEY_ALIAS)) {
            KeyStore.Entry entry = keyStore.getEntry(KEY_ALIAS, null);
            if (entry instanceof KeyStore.SecretKeyEntry) {
                return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
            }
        }

        KeyGenerator keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build();
        keyGenerator.init(spec);
        return keyGenerator.generateKey();
    }

    private SharedPreferences getPrefs() {
        return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void setItem(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");
        if (key == null || key.isEmpty() || value == null) {
            call.reject("Missing key or value");
            return;
        }
        try {
            SecretKey secretKey = getOrCreateSecretKey();
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey);
            byte[] iv = cipher.getIV();
            byte[] cipherBytes = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));

            ByteBuffer buffer = ByteBuffer.allocate(4 + iv.length + cipherBytes.length);
            buffer.putInt(iv.length);
            buffer.put(iv);
            buffer.put(cipherBytes);

            String encoded = Base64.encodeToString(buffer.array(), Base64.NO_WRAP);
            boolean saved = getPrefs().edit().putString(key, encoded).commit();
            if (!saved) {
                call.reject("Failed to commit encrypted vault item to SharedPreferences");
                return;
            }
            call.resolve();
        } catch (Exception ex) {
            call.reject("Failed to encrypt vault item: " + ex.getMessage(), ex);
        }
    }

    @PluginMethod
    public void getItem(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty()) {
            call.reject("Missing key");
            return;
        }
        try {
            String encoded = getPrefs().getString(key, null);
            JSObject ret = new JSObject();
            if (encoded == null) {
                ret.put("value", (Object) null);
                call.resolve(ret);
                return;
            }
            byte[] raw = Base64.decode(encoded, Base64.NO_WRAP);
            if (raw.length < 4) {
                call.reject("Corrupt encrypted vault payload");
                return;
            }
            ByteBuffer buffer = ByteBuffer.wrap(raw);
            int ivLen = buffer.getInt();
            if (ivLen < GCM_IV_LENGTH || ivLen > 32 || buffer.remaining() <= ivLen) {
                call.reject("Corrupt encrypted vault header");
                return;
            }
            byte[] iv = new byte[ivLen];
            buffer.get(iv);
            byte[] cipherBytes = new byte[buffer.remaining()];
            buffer.get(cipherBytes);

            SecretKey secretKey = getOrCreateSecretKey();
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, secretKey, new GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv));
            byte[] plainBytes = cipher.doFinal(cipherBytes);

            ret.put("value", new String(plainBytes, StandardCharsets.UTF_8));
            call.resolve(ret);
        } catch (Exception ex) {
            call.reject("Failed to decrypt vault item: " + ex.getMessage(), ex);
        }
    }

    @PluginMethod
    public void removeItem(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty()) {
            call.reject("Missing key");
            return;
        }
        boolean removed = getPrefs().edit().remove(key).commit();
        if (!removed) {
            call.reject("Failed to remove vault item");
            return;
        }
        call.resolve();
    }
}
