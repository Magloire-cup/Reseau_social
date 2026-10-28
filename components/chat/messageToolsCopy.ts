export const messageToolsCopy = {
    fr: {
        actions: "Actions du message", copy: "Copier le texte", copied: "Texte copié.", copyFailed: "Copie impossible. Sélectionne le texte pour le copier.",
        edit: "Modifier le message", editLabel: "Nouveau texte", save: "Enregistrer", saving: "Enregistrement…", cancel: "Annuler", close: "Fermer",
        editFailed: "Modification impossible. Réessaie.", conflict: "Ce message a changé ou n'est plus modifiable. Ferme cette fenêtre et recharge la conversation.",
        forward: "Transférer le texte", forwardTo: "Conversation destinataire", choose: "Choisir une conversation", forwardNote: "Seul le texte est transféré, sans les réponses ni les réactions.",
        forwarding: "Transfert…", forwarded: "Message transféré.", forwardFailed: "Transfert impossible. Vérifie que le message existe et que la conversation est accessible.", noDestination: "Aucune autre conversation disponible.",
        search: "Rechercher dans les messages", searchHint: "Recherche dans tout l'historique de cette conversation.", searchPlaceholder: "Texte à rechercher", searchEmpty: "Aucun message trouvé.", searchFailed: "Recherche impossible. Réessaie.",
        loading: "Chargement…", more: "Afficher les résultats suivants", you: "Vous", member: "Membre", send: "Envoyer le message"
    },
    en: {
        actions: "Message actions", copy: "Copy text", copied: "Text copied.", copyFailed: "Could not copy. Select the text to copy it manually.",
        edit: "Edit message", editLabel: "New text", save: "Save", saving: "Saving…", cancel: "Cancel", close: "Close",
        editFailed: "Could not edit. Try again.", conflict: "This message changed or can no longer be edited. Close this window and reload the conversation.",
        forward: "Forward text", forwardTo: "Destination conversation", choose: "Choose a conversation", forwardNote: "Only the text is forwarded, without replies or reactions.",
        forwarding: "Forwarding…", forwarded: "Message forwarded.", forwardFailed: "Could not forward. Check that the message still exists and the conversation is accessible.", noDestination: "No other conversation available.",
        search: "Search messages", searchHint: "Search this conversation's entire history.", searchPlaceholder: "Text to search for", searchEmpty: "No messages found.", searchFailed: "Search failed. Try again.",
        loading: "Loading…", more: "Show more results", you: "You", member: "Member", send: "Send message"
    }
};

export type MessageToolsLabels = typeof messageToolsCopy.fr;
export type TextMessageRow = { id: string; conversation_id: string; sender_id: string | null; content: string; type: string; created_at: string; status: "sent" | "delivered" | "read"; reply_to_id?: string | null; deleted_at?: string | null };
