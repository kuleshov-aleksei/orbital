<template>
  <article class="legal-doc" data-testid="legal-terms">
    <p class="legal-meta">Last updated: {{ LEGAL.lastUpdated }}</p>

    <div class="legal-summary" data-testid="legal-terms-tldr">
      <p><strong>TL;DR</strong></p>
      <ul>
        <li>
          Orbital is a free, small chat service run by private individuals, on a
          best-effort basis. You must be at least {{ LEGAL.minimumAge }} years old to use our service.
        </li>
        <li>
          Be decent: no harassment, illegal content, malware, spam, or attacks on the service, and
          don't record or share other people's voice, video or screen without their consent.
        </li>
        <li>
          Your content stays yours. We only store and show it so Orbital works for you and the
          people you share it with.
        </li>
        <li>
          Administrators can moderate and delete content. Messages are not end-to-end encrypted.
        </li>
        <li>
          There are no uptime guarantees and we may lose or remove data, so keep copies of anything
          important. We can suspend accounts that break these rules.
        </li>
        <li>
          To delete your account or ask anything, email
          <a :href="`mailto:${LEGAL.contactEmail}`">{{ LEGAL.contactEmail }}</a
          >.
        </li>
      </ul>
    </div>

    <h2>1. Agreement</h2>
    <p>
      These terms are an agreement between you and the people who run the Orbital server at
      <a :href="LEGAL.serviceUrl" target="_blank" rel="noopener">{{ serviceHost }}</a>
      ("we", "us"). Orbital is a small, privately run service for friends and small
      communities, not a commercial product. By creating an account, signing in, or continuing as a
      guest you accept these terms and our Privacy Policy. If you do not accept them, do not use
      Orbital.
    </p>

    <h2>2. What Orbital is</h2>
    <p>
      Orbital is a voice, video and text chat app for small groups. We run it on our own server and
      offer it free of charge, as a web app and as desktop and Android apps that connect to that
      server.
    </p>
    <p>
      The Orbital source code is published under the MIT License at
      <a :href="LEGAL.sourceUrl" target="_blank" rel="noopener">GitHub</a>. That license governs the
      code; these terms govern your use of our server. If you use Orbital on a server run by someone
      else, their terms apply there, not these.
    </p>

    <h2>3. Who can use Orbital</h2>
    <p>
      You must be at least <strong>{{ LEGAL.minimumAge }}</strong> years old and able to accept
      these terms. If you use Orbital on behalf of an organisation, you confirm you are allowed to
      accept these terms for it.
    </p>

    <h2>4. Your account</h2>
    <ul>
      <li>
        Give accurate information and keep your password private. You are responsible for what
        happens under your account.
      </li>
      <li>One person, one account. Do not share accounts or sell access to them.</li>
      <li>
        Guest accounts live on the device that created them. If you clear the app's data or lose the
        device, the guest account cannot be recovered.
      </li>
      <li>
        Each device you sign in on is a separate session. Sign out devices you no longer control in
        <strong>Settings → Security</strong>.
      </li>
      <li>
        If you think your account has been compromised, tell us at
        <a :href="`mailto:${LEGAL.securityEmail}`">{{ LEGAL.securityEmail }}</a
        >.
      </li>
    </ul>

    <h2>5. Acceptable use</h2>
    <p>You agree not to:</p>
    <ol>
      <li>Harass, threaten, stalk, defame or impersonate anyone, or get others to do so.</li>
      <li>
        Post content that is illegal, infringes someone else's rights, sexually exploits minors, or
        incites violence or hatred.
      </li>
      <li>Upload malware, or content you have no right to share.</li>
      <li>
        Try to get into accounts, servers or data that aren't yours; probe, scan or overload the
        service; or get around rate limits, permissions or version checks.
      </li>
      <li>
        Record, stream or redistribute another member's voice, video or screen without their
        knowledge and consent.
      </li>
      <li>Scrape, bulk-export or sell other members' data or content.</li>
      <li>Create new accounts to get around a suspension or ban.</li>
      <li>Send spam or unsolicited advertising.</li>
    </ol>

    <h2>6. Your content</h2>
    <p>
      You keep ownership of the messages, files, images and other content you post. You give us
      permission to store, transmit, process (for example thumbnails, previews and text recognition
      for search) and display that content, <strong>only so we can run Orbital</strong> for you and
      the members you share it with. This permission ends when the content is deleted, except for
      copies that remain in backups until they are rotated out, or that we must keep to comply with
      the law or resolve a dispute.
    </p>
    <p>
      You confirm you have the right to post what you post, and that posting it does not infringe
      anyone else's rights.
    </p>

    <h2>7. Voice, video and screen sharing</h2>
    <p>
      Calls are relayed in real time by our media server and are not recorded by us. Other
      participants can still capture what they see and hear with their own tools, so treat a call as
      visible to everyone in it. Do not share screens showing other people's confidential
      information.
    </p>

    <h2>8. Administrators and moderation</h2>
    <p>
      Orbital has roles and permissions. Administrators, and members they give permissions to, can
      create and delete channels, manage roles and members, delete messages and attachments, and
      read the channels they have access to. Administrators can also see diagnostic logs you choose
      to send, and can remove your content.
    </p>
    <p>
      Messages and files are not end-to-end encrypted. The people who run the server can technically
      access stored data; we only do so to run, secure or troubleshoot the service, or when the law
      requires it. If you believe someone has misused their permissions, write to
      <a :href="`mailto:${LEGAL.contactEmail}`">{{ LEGAL.contactEmail }}</a
      >.
    </p>

    <h2>9. Names, logos and other people's content</h2>
    <p>
      You may use the Orbital source code under its MIT License. These terms do not give you any
      right to use the Orbital name or logo to suggest that we endorse you, or to use content posted
      by other members beyond what is needed to use the service.
    </p>

    <h2>10. Availability and changes</h2>
    <p>
      Orbital is run on a best-effort basis by a small team. We may change, add or remove features,
      and we may need to take the service offline for maintenance or security. We do not guarantee
      uptime. If we decide to shut Orbital down, we will try to give at least 30 days' notice in the
      app so you can save what you need.
      <strong>
        Nothing in these terms obliges us to keep your content; keep your own copies of anything you
        cannot afford to lose.
      </strong>
    </p>

    <h2>11. Suspension and termination</h2>
    <p>
      You can stop using Orbital at any time and ask us to delete your account by writing to
      <a :href="`mailto:${LEGAL.contactEmail}`">{{ LEGAL.contactEmail }}</a
      >. We may suspend or close your account if you seriously break these terms, if the law
      requires it, or if your use puts the service or other members at risk. Where practical, we
      will tell you first. When your account is closed your right to use Orbital ends; the parts of
      these terms that by their nature should continue (the content permission for retained copies,
      disclaimers and liability limits) still apply.
    </p>

    <h2>12. Disclaimers</h2>
    <p>
      As far as the law allows, Orbital is provided <strong>"as is" and "as available"</strong>,
      without warranties of any kind, including fitness for a particular purpose and uninterrupted
      or error-free operation. We do not check, and are not responsible for, content posted by other
      members. Nothing here removes rights you have by law as a consumer.
    </p>

    <h2>13. Limitation of liability</h2>
    <p>
      Orbital is a free service. As far as the law allows, we are not liable for indirect,
      incidental, special or consequential damages, or for lost data, profits or goodwill, arising
      from your use of Orbital. Nothing here limits liability for death or personal injury caused by
      negligence, for fraud, or for anything else that cannot be limited by law.
    </p>

    <h2>14. Changes to these terms</h2>
    <p>
      We may update these terms. We will announce material changes in the app before they take
      effect, and using Orbital after that date means you accept them. If you do not agree, stop
      using Orbital and ask us to delete your account.
    </p>

    <h2>15. Contact</h2>
    <p>
      <a :href="`mailto:${LEGAL.contactEmail}`">{{ LEGAL.contactEmail }}</a>
    </p>
  </article>
</template>

<script setup lang="ts">
import { LEGAL } from "./legalInfo"

const serviceHost = new URL(LEGAL.serviceUrl).host
</script>
