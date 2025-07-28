try {
  const { RealtimeService } = await import('./service.js');
  const service = new RealtimeService();

  self.onmessage = (event) => {
    service.handle(event, (res) => {
      self.postMessage(res);
    });
  };
} catch (err) {
  self.postMessage(err);
}
