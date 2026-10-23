import net from 'node:net';
import tls from 'node:tls';
import {once} from 'node:events';

// Test-only loopback transport for workerd, which cannot load a custom CA.
// The Node endpoint verifies the Supabase certificate AND hostname before
// forwarding any PostgreSQL startup/authentication traffic.
export async function postgresTlsBridge(connection:string,ca?:string){
  const remote=new URL(connection),sockets=new Set<net.Socket>();
  const server=net.createServer(client=>{
    client.pause();sockets.add(client);
    client.on('close',()=>sockets.delete(client));
    client.on('error',()=>{});
    const upstream=net.connect({host:remote.hostname,port:Number(remote.port||5432)});
    sockets.add(upstream);upstream.on('close',()=>sockets.delete(upstream));
    upstream.on('error',()=>client.destroy());
    client.on('close',()=>upstream.destroy());
    upstream.once('connect',()=>{
      const request=Buffer.alloc(8);request.writeInt32BE(8);request.writeInt32BE(80877103,4);
      upstream.write(request);
    });
    upstream.once('data',response=>{
      if(response.length!==1||response[0]!==83){client.destroy();upstream.destroy();return;}
      const secure=tls.connect({socket:upstream,servername:remote.hostname,rejectUnauthorized:true,...(ca?{ca}:{})});
      sockets.add(secure);secure.on('close',()=>sockets.delete(secure));
      secure.on('error',()=>client.destroy());client.on('close',()=>secure.destroy());
      secure.once('secureConnect',()=>{client.pipe(secure);secure.pipe(client);client.resume();});
    });
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address() as net.AddressInfo;
  const local=new URL(connection);local.hostname='127.0.0.1';local.port=String(address.port);local.search='';
  return {url:local.toString(),close:async()=>{for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
