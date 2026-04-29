'use strict';

async function checkAuth() {
  const { data: { session } } = await supaClient.auth.getSession();
  if (!session) {
    window.location.replace('/login.html');
    await new Promise(() => {}); // pause execution while redirect happens
  }
  return session.user;
}

async function logoutUser() {
  await supaClient.auth.signOut();
  window.location.replace('/login.html');
}
