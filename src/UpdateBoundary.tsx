import {Component,type ReactNode} from 'react';
import {Logo} from './Brand';
export class UpdateBoundary extends Component<{children:ReactNode},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){
    if(!this.state.failed)return this.props.children;
    return <main className="loading-screen" role="alert"><Logo/><h1>No se ha podido abrir esta vista</h1><p>Recarga para abrir la versión actual de Vyrsea. Los cambios que ya guardaste se conservan.</p><button className="button primary" onClick={()=>location.reload()}>Recargar Vyrsea</button></main>;
  }
}
