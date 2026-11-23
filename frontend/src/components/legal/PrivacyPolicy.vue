<template>
  <article class="legal-doc" data-testid="legal-privacy">
    <p class="legal-meta">Last updated: {{ LEGAL.lastUpdated }}</p>

    <div class="legal-summary" data-testid="legal-privacy-tldr">
      <p><strong>TL;DR</strong></p>
      <ul>
        <li>
          Orbital is a small, free service run by private individuals. No ads, no trackers, no
          third-party analytics, and we never sell your data.
        </li>
        <li>
          We store your account, profile, messages and files, the devices you sign in on (with IP
          address), the calls you join (when and on which device) and logs you choose to send.
        </li>
        <li>
          Some things reach other companies: Google or Discord when you sign in with them, Google
          Firebase for Android notifications, Klipy or Giphy when GIFs are searched or shown,
          Discord or Google when their profile pictures are shown, and YouTube when you press play
          on a video.
        </li>
        <li>
          Messages and files are not end-to-end encrypted: the people who run the server could
          access them, and only do so to keep the service running.
        </li>
        <li>
          You can delete your account yourself in Settings → Security. To get a copy of your data,
          email <a :href="`mailto:${LEGAL.contactEmail}`">{{ LEGAL.contactEmail }}</a
          >.
        </li>
      </ul>
    </div>

    <h2>1. Who we are</h2>
    <p>
      This policy explains what is collected when you use the Orbital server at
      <a :href="LEGAL.serviceUrl" target="_blank" rel="noopener">{{ serviceHost }}</a>
      through the web app, the desktop app or the Android app, and what we do with it. "We" means
      the people who run that server. We are the data controller; you can reach us at
      <a :href="`mailto:${LEGAL.contactEmail}`">{{ LEGAL.contactEmail }}</a
      >.
    </p>
    <p>
      Orbital is open source, so anyone can run their own server. If you use a server run by someone
      else, that person is the data controller and this policy does not apply.
    </p>

    <h2>2. What we collect</h2>

    <h3>2.1 Account data</h3>
    <p>You can use Orbital as a guest, with an email and password, or with Google or Discord.</p>
    <ul>
      <li>
        <strong>Guest:</strong> an identifier generated on your device and an automatic nickname. No
        email, no password.
      </li>
      <li>
        <strong>Email and password:</strong> your email address, nickname and a bcrypt hash of your
        password. We never store the password itself.
      </li>
      <li>
        <strong>Google / Discord:</strong> the account identifier, email address, display name and
        avatar URL the provider returns. We ask only for basic profile and email access, and we
        never see your password or your activity on those services.
      </li>
    </ul>

    <h3>2.2 Profile data you add</h3>
    <p>
      Nickname, avatar, custom status text and emoji, nickname colour, displayed badge and
      sound-pack preference.
    </p>

    <h3>2.3 Sign-in sessions</h3>
    <p>
      For each device you sign in on we record the client type, browser user agent, IP address, and
      when the session was created, last used and expires. You can see these in
      <strong>Settings → Security</strong> and sign out any of them, which helps you spot a session
      you don't recognise.
    </p>

    <h3>2.4 Presence</h3>
    <p>
      While you are connected, other members see whether you are online, away or on mobile, and your
      custom status. "Away" means none of your sessions has been used in the last 10 minutes.
      Whether your microphone is muted is used only to decide whether to send you a push
      notification; your audio itself never reaches our application server.
    </p>

    <h3>2.5 Voice, video and screen sharing</h3>
    <p>
      Calls go through a media server (LiveKit) that we run ourselves. Audio, video and screen
      shares are relayed live and are never recorded or stored. Orbital asks for microphone and
      camera access through your browser or operating system, and you can revoke it at any time.
    </p>

    <h3>2.6 Text channels</h3>
    <p>
      Messages you post, with their attachments, reactions, mentions, pins and edits, are stored on
      our server so other members can read them. We also store how far you have read in each channel
      and your notification settings.
    </p>
    <p>
      When you vote in a poll, we store which answers you picked together with your account, so you
      can see and change your vote. In a public poll other members can see who voted for what. In an
      anonymous poll they only see the totals: who voted for what is kept on the server, never shown
      to other members. Votes are deleted with the poll.
    </p>

    <h3>2.7 Attachments</h3>
    <p>
      Files you upload are kept in file storage on our server, along with their name, size, type,
      dimensions or duration. To let members search images by their contents, our server extracts
      text from images (OCR) and computes an image description vector. This runs on our own local
      machine learning service; your files are not sent to any outside AI provider.
    </p>

    <h3>2.8 Link previews</h3>
    <p>
      When someone posts a link, our server fetches the page to build a preview. The linked site
      sees our server's IP address, not yours, and can tell that the link was opened. Preview text
      and images are cached on our server for reuse.
    </p>

    <h3>2.9 Content loaded from other companies</h3>
    <p>
      Some things you see in Orbital are loaded by your device directly from another company's
      servers. That company then sees your IP address and basic browser information, and can tell
      what was loaded.
    </p>
    <ul>
      <li>
        <strong>GIFs:</strong> when you search in the GIF picker, your search text goes from your
        device to Klipy or Giphy (whichever this server uses). GIFs posted in a channel are loaded
        from their servers whenever someone views them, so this happens for everyone who reads the
        channel, not only for the person who posted the GIF.
      </li>
      <li>
        <strong>Profile pictures from Discord or Google:</strong> if someone signed in with Discord
        or Google and kept that account's picture, it is loaded from Discord's or Google's servers
        wherever it is shown.
      </li>
      <li>
        <strong>YouTube:</strong> for a posted YouTube link we show a preview image from our own
        server. The YouTube player (from YouTube's privacy-enhanced domain) loads only after you
        press play.
      </li>
    </ul>

    <h3>2.10 Push notifications (Android app)</h3>
    <p>
      If you allow notifications, Google Firebase gives your device a token, which we store with
      your account and session. A notification can include the channel name and a short preview of
      the message. Refusing notifications does not affect anything else.
    </p>

    <h3>2.11 Diagnostic logs you choose to send</h3>
    <p>
      When you use "Send logs", we store the app log together with technical details: app version,
      browser and version, window and screen size, colour depth, language, platform and user agent,
      and in the desktop app the operating system, its version and architecture, desktop environment
      and runtime versions. Administrators use these reports only to fix bugs.
    </p>

    <h3>2.12 Call history and usage statistics</h3>
    <p>
      Each time you join a voice room we record which room, when you joined and left, and your
      platform and device type. Administrators use these records to see totals such as active rooms,
      session lengths, platforms and app versions, and to troubleshoot connection problems. We do
      not use third-party analytics or advertising tools.
    </p>

    <h3>2.13 Data stored on your device</h3>
    <p>
      The app keeps your sign-in token, basic profile and server settings in your browser's local
      storage. It also keeps an offline copy of rooms, members, permissions, badges, emojis, the
      latest 50 messages of each channel you opened, and messages waiting to be sent, in your
      browser's IndexedDB (the desktop and Android apps also cache media on the device). This copy
      is deleted when you sign out.
    </p>

    <h2>3. Cookies</h2>
    <p>
      We set a single cookie, only while you sign in with Google or Discord: a short-lived value
      that protects the sign-in against forgery. There are no advertising, tracking or analytics
      cookies.
    </p>

    <h2>4. Why we use your data</h2>
    <p>We use the data above to:</p>
    <ul>
      <li>create and protect your account;</li>
      <li>
        show you and other members the profiles, presence and messages you expect in a chat app;
      </li>
      <li>deliver your calls and messages;</li>
      <li>send the notifications you asked for;</li>
      <li>keep the service running and secure (abuse prevention, sessions, rate limits);</li>
      <li>fix problems you report.</li>
    </ul>
    <p>
      Where the GDPR or a similar law applies, our legal bases are
      <strong>performance of a contract</strong> (providing the service you signed up for),
      <strong>legitimate interests</strong> (security, abuse prevention, call history and usage
      statistics) and <strong>consent</strong> (push notifications and diagnostic logs you choose to
      send). GIFs and YouTube videos are loaded because you or another member chose to use those
      features (section 2.9). You can withdraw consent at any time without affecting your account.
    </p>

    <h2>5. Who else sees your data</h2>
    <ul>
      <li>
        <strong>Other members</strong> see your nickname, avatar, status, presence, roles and the
        messages and media you post in channels they can access. Treat anything you post in a shared
        channel as visible to everyone in it.
      </li>
      <li>
        <strong>Administrators</strong> can see your account record, diagnostic logs you sent and
        usage totals, and can read channels they have access to. Administrators with extra
        permissions can delete accounts and content.
      </li>
      <li>
        <strong>The people who run the server</strong> have technical access to everything stored on
        it. We only use that access to run, secure and troubleshoot Orbital, or when the law
        requires it.
      </li>
      <li>
        <strong>Google Firebase</strong> handles device tokens and notification contents for the
        Android app.
      </li>
      <li>
        <strong>Google and Discord</strong> handle sign-in if you choose them, under their own
        privacy policies.
      </li>
      <li>
        <strong>Klipy or Giphy</strong> receive GIF searches and serve the GIFs shown in channels
        (see 2.9).
      </li>
      <li>
        <strong>Discord and Google</strong> serve profile pictures of people who signed in with
        them, and <strong>YouTube (Google)</strong> serves videos you choose to play (see 2.9).
      </li>
      <li>
        <strong>Websites you link to</strong> are contacted by our server to build link previews
        (see 2.8).
      </li>
    </ul>
    <p>
      Apart from these, the app server, database, search index, file storage, media server and image
      recognition run on infrastructure we administer ourselves, and your data is not sent to any
      other online service. Google, Firebase, Discord, Klipy and Giphy may process data outside of
      the EU, including in the United States, under their own safeguards.
    </p>
    <p>We do not sell your personal data or share it with advertisers or data brokers.</p>

    <h2>6. How long we keep it</h2>
    <ul>
      <li><strong>Account and profile:</strong> until your account is deleted.</li>
      <li>
        <strong>Guest accounts:</strong> until an administrator deletes them, or you ask us to.
      </li>
      <li>
        <strong>Sign-in sessions:</strong> a session you sign out is deleted at once. An expired
        session can stay in our records for some time after it expires.
      </li>
      <li>
        <strong>Call history:</strong> for as long as your account exists; after deletion it stays
        for usage statistics, no longer linked to your profile.
      </li>
      <li><strong>Status and presence:</strong> live only; no history is kept.</li>
      <li>
        <strong>Messages and attachments:</strong> as long as the message and its channel exist.
        Deleted messages are removed, and their files are purged in the background.
      </li>
      <li>
        <strong>Diagnostic logs:</strong> deleted by an administrator once the problem is
        investigated, normally within about a week.
      </li>
      <li><strong>Link previews:</strong> until the cache is cleaned up.</li>
      <li>
        <strong>Push tokens:</strong> until you sign out, turn notifications off, or the token stops
        working.
      </li>
      <li>
        <strong>Backups:</strong> deleted data can remain in server backups until those backups are
        overwritten.
      </li>
    </ul>
    <p>
      When your account is deleted, your profile, email, sign-in sessions, push tokens, settings,
      reminders, diagnostic logs and every file you uploaded are deleted. Messages you posted, your
      reactions and poll votes stay visible to other members as written by "Deleted user". Call
      history stays for usage statistics but is no longer linked to anything that identifies you. If
      you want your messages removed too, delete them before deleting your account, or ask us.
    </p>

    <h2>7. Your rights</h2>
    <p>
      In the app you can edit your nickname, avatar and status, mute or leave channels, change
      notification settings, and see and sign out your devices.
    </p>
    <p id="delete-account">
      You can delete your whole account in Settings → Security → Delete account. To get a copy of
      your data, correct it, delete it or your account, restrict how we use it, or object to it,
      write to
      <a :href="`mailto:${LEGAL.contactEmail}`">{{ LEGAL.contactEmail }}</a> from the email linked
      to your account, or tell us your nickname. Orbital is a small, privately run service, so we
      handle these requests by hand. We answer within one month, as GDPR require.
    </p>
    <p>You can complain to the your local data protection authority.</p>

    <h2>8. Security</h2>
    <p>
      Passwords are stored as bcrypt hashes. Sign-in tokens are per device, can be revoked one by
      one, and expire. All connections use TLS. Access to the server is limited to the people who
      run it. Messages and files are encrypted in transit but not end to end, so do not post
      anything in Orbital you could not accept the server operators seeing. Please use a password
      you don't use anywhere else.
    </p>

    <h2>9. Children</h2>
    <p>
      Orbital is not meant for anyone under {{ LEGAL.minimumAge }}, and we do not knowingly collect
      their data. If you believe a child has created an account, contact us and we will delete it.
    </p>

    <h2>10. Changes to this policy</h2>
    <p>
      If we change this policy in a way that matters, we will announce it in the app before the
      change takes effect. The date at the top shows the latest version.
    </p>

    <h2>11. Contact</h2>
    <p>
      <a :href="`mailto:${LEGAL.contactEmail}`">{{ LEGAL.contactEmail }}</a>
    </p>
  </article>
</template>

<script setup lang="ts">
import { LEGAL } from "./legalInfo"

const serviceHost = new URL(LEGAL.serviceUrl).host
</script>
