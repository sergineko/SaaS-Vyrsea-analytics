import {Modal} from './ui';
import {SupportRequestForm} from './SupportRequestForm';
import './support.css';
export default function ContactModal({onClose}:{onClose:()=>void}){return <Modal title="Contacta con Vyrsea" onClose={onClose}><p>Consulta sobre el servicio, informa de un problema o solicita ayuda con tu acceso.</p><SupportRequestForm/></Modal>;}
