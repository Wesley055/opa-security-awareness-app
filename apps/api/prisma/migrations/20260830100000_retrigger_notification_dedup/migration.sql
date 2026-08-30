-- Prevent duplicate contact/channel delivery intents for the same incident.
--
-- Retriggers may reconcile newly-added emergency contacts. Multiple concurrent
-- SOS activations must never create duplicate notification intents for a
-- contact/channel that has already been queued for the incident.
--
-- contactId remains nullable for non-contact/legacy notification producers.
CREATE UNIQUE INDEX "IncidentNotification_incidentId_contactId_channel_key"
ON "IncidentNotification" ("incidentId", "contactId", "channel")
WHERE "contactId" IS NOT NULL;
