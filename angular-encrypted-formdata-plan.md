# Angular Plan: Encrypted Multipart / FormData Upload

## 1. Goal

Send file uploads as `multipart/form-data` where all non-file fields are encrypted:

| Part    | Content                                                        |
|---------|----------------------------------------------------------------|
| `ssId`  | Session id (plain text, also used as AES-GCM AAD)              |
| `ek`    | AES-256 key wrapped with server RSA public key (RSA-OAEP, SHA-256), base64 |
| `ep`    | `iv (12 bytes) \|\| AES-GCM ciphertext+tag` of the JSON of all non-file fields, base64 |
| `Files` | Binary file part(s) (optionally encrypted, see section 8)      |

---

## 2. Flow

```
Component
   │  fields (FolderId, TagIds, ...) + File[]
   ▼
DocumentUploadService
   │  1. get ssId + public key  (SessionService / environment)
   ▼
CryptoService
   │  2. generate AES-256-GCM key (per request)
   │  3. encrypt JSON(fields) -> ep
   │  4. wrap AES key with RSA public key -> ek
   ▼
FormData { ssId, ek, ep, Files }
   ▼
HttpClient.post(...)  ──►  FastAPI: unwrap ek, decrypt ep, process Files
```

---

## 3. Folder Structure

```
src/app/
  core/
    crypto/
      crypto.service.ts          # Web Crypto wrapper (AES-GCM + RSA-OAEP)
      crypto.util.ts             # base64 / PEM helpers
      crypto.models.ts           # interfaces
    session/
      session.service.ts         # ssId + public key provider
  features/documents/
    document-upload.service.ts   # builds FormData, calls API
    document-upload.component.ts # UI + form
```

---

## 4. Prerequisites

- App must run in a **secure context** (HTTPS or `localhost`), otherwise `crypto.subtle` is `undefined`.
- Confirm with backend:
  - Public key format (PEM SPKI assumed; JWK needs a different import call)
  - OAEP hash: **SHA-256** for both hash and MGF1
  - `ep` layout: `iv || ciphertext || tag`
  - Whether `ssId` is used as AAD
  - Whether files must be encrypted too
- Only the **public** key lives in the frontend. Never ship the private key.

---

## 5. Implementation

### 5.1 `crypto.util.ts`

```ts
export function bufToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000; // avoid call-stack limits on large buffers
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function base64ToBuf(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----(BEGIN|END) PUBLIC KEY-----|\s/g, '');
  return base64ToBuf(b64);
}
```

### 5.2 `crypto.models.ts`

```ts
export interface EncryptedPayload {
  ek: string; // base64 RSA-OAEP wrapped AES key
  ep: string; // base64 iv || ciphertext+tag
  aesKey: CryptoKey; // kept in memory only if files are also encrypted
}
```

### 5.3 `crypto.service.ts`

```ts
import { Injectable } from '@angular/core';
import { bufToBase64, pemToDer } from './crypto.util';
import { EncryptedPayload } from './crypto.models';

@Injectable({ providedIn: 'root' })
export class CryptoService {
  private readonly enc = new TextEncoder();
  private rsaKeyCache = new Map<string, CryptoKey>();

  private async importRsaPublicKey(pem: string): Promise<CryptoKey> {
    const cached = this.rsaKeyCache.get(pem);
    if (cached) return cached;

    const key = await crypto.subtle.importKey(
      'spki',
      pemToDer(pem),
      { name: 'RSA-OAEP', hash: 'SHA-256' }, // must match backend
      false,
      ['encrypt'],
    );
    this.rsaKeyCache.set(pem, key);
    return key;
  }

  async encryptFields(
    fields: Record<string, unknown>,
    ssId: string,
    publicKeyPem: string,
  ): Promise<EncryptedPayload> {
    // 1. Fresh AES-256-GCM key per request
    const aesKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt'],
    );

    // 2. Encrypt JSON fields
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: this.enc.encode(ssId) },
      aesKey,
      this.enc.encode(JSON.stringify(fields)),
    );

    const payload = new Uint8Array(iv.length + cipher.byteLength);
    payload.set(iv, 0);
    payload.set(new Uint8Array(cipher), iv.length);

    // 3. Wrap AES key with RSA-OAEP
    const rsaPub = await this.importRsaPublicKey(publicKeyPem);
    const rawAes = await crypto.subtle.exportKey('raw', aesKey);
    const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, rsaPub, rawAes);

    return { ek: bufToBase64(wrapped), ep: bufToBase64(payload), aesKey };
  }

  /** Optional: encrypt a file with the same AES key (new IV). Output = iv || ciphertext+tag */
  async encryptFile(file: File, aesKey: CryptoKey): Promise<Blob> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      await file.arrayBuffer(),
    );
    return new Blob([iv, cipher], { type: 'application/octet-stream' });
  }
}
```

### 5.4 `session.service.ts`

```ts
import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SessionService {
  // Replace with your real source (login response, cookie, store, etc.)
  getSessionId(): string {
    return sessionStorage.getItem('ssId') ?? '';
  }

  getPublicKeyPem(): string {
    return environment.rsaPublicKeyPem; // or fetch once from an endpoint and cache
  }
}
```

### 5.5 `document-upload.service.ts`

```ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CryptoService } from '../../core/crypto/crypto.service';
import { SessionService } from '../../core/session/session.service';

export interface DocumentUploadFields {
  FileName: string;
  FolderId: number;
  CategoryId: number;
  IsNewFolder: boolean;
  LibraryType: number;
  IsUploaded: boolean;
  IsMarkSecure: boolean;
  Receipient?: string;
  SigningAuthority: number;
  FileNumber: string;
  DocumentNumber: string;
  DocumentTypeId: number;
  DocumentType: string;
  SystemDate?: string;
  DepartmentId: number;
  FileCreationDate: string;
  TagIds: number[];
}

@Injectable({ providedIn: 'root' })
export class DocumentUploadService {
  private http = inject(HttpClient);
  private crypto = inject(CryptoService);
  private session = inject(SessionService);

  async buildFormData(fields: DocumentUploadFields, files: File[]): Promise<FormData> {
    const ssId = this.session.getSessionId();
    const { ek, ep } = await this.crypto.encryptFields(
      { ...fields, SystemDate: new Date().toISOString() },
      ssId,
      this.session.getPublicKeyPem(),
    );

    const fd = new FormData();
    fd.append('ssId', ssId);
    fd.append('ek', ek);
    fd.append('ep', ep);
    files.forEach((f) => fd.append('Files', f, f.name));
    return fd;
  }

  async upload(fields: DocumentUploadFields, files: File[]): Promise<Observable<unknown>> {
    const body = await this.buildFormData(fields, files);
    // IMPORTANT: do not set Content-Type. Browser adds the multipart boundary.
    return this.http.post('/api/documents/upload', body, { reportProgress: true, observe: 'events' });
  }
}
```

### 5.6 Component usage

```ts
async onSubmit() {
  const fields: DocumentUploadFields = {
    FileName: this.file.name,
    FolderId: 96,
    CategoryId: 9,
    IsNewFolder: false,
    LibraryType: 2,
    IsUploaded: true,
    IsMarkSecure: false,
    SigningAuthority: 3,
    FileNumber: 'DCS - 1269',
    DocumentNumber: '2026-FIN-13',
    DocumentTypeId: 2,
    DocumentType: 'MoM',
    DepartmentId: 3,
    FileCreationDate: '2026-10-29T13:08:42',
    TagIds: [3],
  };

  const req$ = await this.uploadService.upload(fields, [this.file]);
  req$.subscribe({
    next: (e) => { /* handle progress / response */ },
    error: (err) => { /* show error */ },
  });
}
```

---

## 6. HTTP Interceptor Checks

- Do **not** add a global interceptor that forces `Content-Type: application/json`. Skip it when `body instanceof FormData`.
- Auth header interceptors are fine, they do not touch the body.
- Do not log or serialize the `FormData` or `aesKey` in any interceptor.

---

## 7. Backend Contract (FastAPI)

```python
def decrypt_fields(private_key, ss_id: str, ek: str, ep: str) -> dict:
    aes_key = private_key.decrypt(
        base64.b64decode(ek),
        padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None),
    )
    raw = base64.b64decode(ep)
    iv, ct = raw[:12], raw[12:]
    return json.loads(AESGCM(aes_key).decrypt(iv, ct, ss_id.encode()))
```

Endpoint form params: `ssId`, `ek`, `ep` as `Form(...)`, `Files` as `list[UploadFile]`.

---

## 8. Optional: Encrypt the File Bytes

By default `Files` are protected only by TLS. To encrypt them too:

1. Call `encryptFields(...)` and keep the returned `aesKey`.
2. For each file: `const blob = await crypto.encryptFile(file, aesKey)`.
3. `fd.append('Files', blob, file.name + '.enc')`.
4. Put original file name and type in the encrypted `ep` JSON.
5. Backend: read first 12 bytes as IV, decrypt the rest with the same AES key.

For large files (hundreds of MB), switch to chunked encryption to avoid loading the whole file into memory.

---

## 9. Security Checklist

- [ ] New AES key and new IV for every request
- [ ] RSA-OAEP hash is SHA-256 on both sides
- [ ] `ssId` used as AAD and validated server-side
- [ ] Add a timestamp or nonce inside `ep`; backend rejects old or duplicate values
- [ ] Only public key in the Angular bundle
- [ ] HTTPS enforced
- [ ] No encrypted or plain payload logged to console
- [ ] Server validates file type and size, regardless of encryption

---

## 10. Testing Plan

1. **Unit tests**: `CryptoService` round trip using a test RSA key pair generated with `crypto.subtle.generateKey`, decrypt in the test and compare JSON.
2. **Cross-check**: encrypt in Angular, decrypt in FastAPI with a shared test key pair. This catches hash, IV and layout mismatches.
3. **Network tab**: confirm request is `multipart/form-data`, with only `ssId`, `ek`, `ep`, `Files` parts (no plain `FolderId`, `TagIds`, etc.).
4. **Negative tests**: tampered `ep` (GCM tag fails), wrong `ssId` (AAD fails), replayed request (rejected).
5. **Large file test** if file encryption is enabled.

---

## 11. Rollout Steps

1. Agree on the contract with backend (section 4 list).
2. Add `core/crypto` and `core/session`.
3. Implement `DocumentUploadService.buildFormData`.
4. Wire into the upload component.
5. Run cross-check test against FastAPI.
6. Enable file-level encryption if required.
7. Security review and remove debug logging.
