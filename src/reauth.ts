import {startAuthentication,type PublicKeyCredentialRequestOptionsJSON} from '@simplewebauthn/browser';
import {request} from './api';
export async function confirmPasskey(){
 const options=await request<PublicKeyCredentialRequestOptionsJSON>('/auth/reauth/options','POST');
 await request('/auth/reauth/verify','POST',await startAuthentication({optionsJSON:options}));
}
