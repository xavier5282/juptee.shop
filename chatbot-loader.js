const root = document.querySelector('#jt-chat-root');
const launcher = root?.querySelector('.jt-chat-launch');
let widget;

if (launcher) {
  launcher.addEventListener('click', async () => {
    launcher.disabled = true;
    try {
      widget ||= import('./chatbot.js');
      const assistant = await widget;
      await assistant.openChat();
    } catch (error) {
      console.error('Could not load the JUPTEE shopping assistant.', error);
      widget = undefined;
      launcher.title = 'The assistant could not load. Please try again.';
    } finally {
      launcher.disabled = false;
    }
  });
}
