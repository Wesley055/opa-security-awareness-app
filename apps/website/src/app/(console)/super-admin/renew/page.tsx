"use client";
import { useEffect, useState } from "react";
import { superAdminFetch } from "@/lib/super-admin-fetch";
export default function Renew() {
 const [message,setMessage]=useState("Renewing your Super Admin session…");
 useEffect(()=>{let alive=true;const controller=new AbortController();void superAdminFetch("refresh",{method:"POST",signal:controller.signal}).then(response=>{if(!alive)return;if(response.ok)window.location.replace("/super-admin");else setMessage("Your session could not be renewed. Sign in again.");}).catch(()=>{if(alive)setMessage("Session renewal is unavailable. Retry or sign in again.");});return()=>{alive=false;controller.abort();};},[]);
 return <main className="sa-body"><p role="status">{message}</p><a href="/super-admin/login">Sign in</a></main>;
}
