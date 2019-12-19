const tree = document.getElementById('tree');
const treeParts = [...tree.querySelectorAll('g g path')];

let drops = [];
const users = {};

const dropPrototype = {
  getLeft() {
    return this.position.x - this.element.clientWidth / 2;
  },
  getRight() {
    return this.position.x + this.element.clientWidth / 2;
  },
  getTop() {
    return this.position.y;
  },
  getBottom() {
    return this.position.y + this.element.clientHeight;
  },
  getCenter() {
    return {
      x: this.position.x,
      y: (this.getTop() + this.getBottom()) / 2,
    };
  }
};

function createDropElement(name, url) {
  const dropElement = document.createElement('div');
  dropElement.classList.add('drop');
  const snowflakeNum = Math.floor(Math.random() * 3) + 1;
  dropElement.innerHTML = `
    <p class="name">
      <span>${name}</span>
    </p>
    <img class="snowflake-bg" src="images/snowflake-${snowflakeNum}.svg" />
    <img class="emote" src="${url}" />
  `;
  return dropElement;
}

function doDrop(username, url) {
  // if (users[username]) return;
  users[username] = true;
  const element = createDropElement(username, url);
  drops.push({
    __proto__: dropPrototype,
    username,
    element,
    velocity: {
      x: (Math.random() * 4) * (Math.random() > 0.5 ? -1 : 1),
      y: (Math.random() * 5) + 2
    },
    position: {
      x: Math.floor(Math.random() * window.innerWidth),
      y: element.clientHeight - 100
    }
  });
  document.body.appendChild(element);
}

function draw() {
  drops.forEach(drop => {
    if (drop.final) return;
    drop.element.style.top = drop.getTop() + 'px';
    drop.element.style.left = drop.getLeft() + 'px';
    if (drop.done) {
      drop.final = true;
    }
  });  
}

function update() {
  drops.forEach(drop => {
    if (drop.done) return;
    drop.position.x += drop.velocity.x;
    drop.position.y += drop.velocity.y;
    
    if(drop.getLeft() < 0) {
      drop.velocity.x = Math.abs(drop.velocity.x);
    } else if(drop.getRight() >= window.innerWidth) {
      drop.velocity.x = -Math.abs(drop.velocity.x);
    } else if (drop.getBottom() >= window.innerHeight - tree.clientHeight) {

      const hasHitTree = treeParts.some(part => {
        const rect = part.getBoundingClientRect();
        return drop.getLeft() >= rect.left && drop.getRight() <= rect.right;
      });

      if (hasHitTree) {
        if (drop.velocity.y === 0) {
          drop.done = true;
          drop.element.classList.add('ornament');
          setTimeout(() => {
            drops = drops.filter(d => d !== drop);
          }, 1000);
          setTimeout(() => {
            users[drop.username] = false;
          }, 30000);
        } else {
          if (drop.velocity.x > 0) {
            drop.velocity.x -= Math.random();
          } else {
            drop.velocity.x += Math.random();
          }
          drop.velocity.y -= Math.random();
          drop.velocity.y = Math.max(0, drop.velocity.y);
        }
      } else if (drop.getBottom() >= window.innerHeight) {
        drop.velocity.y = 0;
        drop.velocity.x = 0;
        drop.position.y = window.innerHeight - drop.element.clientHeight;
        drop.done = true;
        drop.element.classList.add('done');
        setTimeout(() => {
          document.body.removeChild(drop.element);
          drops = drops.filter(d => d !== drop);
          users[drop.username] = false;
        }, 30000);
      }
    }
  });
}

function gameLoop() {
  update();
  draw();
  requestAnimationFrame(gameLoop);
}

for (let i = 0; i < 50; i++) {  
  doDrop('Alca', 'https://static-cdn.jtvnw.net/emoticons/v1/328626_SA/3.0');
}


gameLoop();

const client = new tmi.Client({
  options: {
    debug: true,
  },
  connection: {
    secure: true,
    reconnect: true
  },
  channels: [ 'codinggarden' ]
});

client.connect();

client.on('message', (channel, tags, message, self) => {
  if (message.startsWith('!drop')) {
    const name = tags['display-name'] || tags.username;
    if (tags.emotes) {
      const emoteIds = Object.keys(tags.emotes);
      const emoteId = emoteIds[Math.floor(Math.random() * emoteIds.length)];
      const url = `https://static-cdn.jtvnw.net/emoticons/v1/${emoteId}/3.0`;
      doDrop(name, url);
    } else {
      const snowflakeNum = Math.floor(Math.random() * 3) + 1;
      doDrop(name, `images/snowflake-${snowflakeNum}.svg`);
    }

    // TODO: !drop me -> twitch api user avatar
    // TODO: !drop ❄️ -> emoji drops!
  }
});
			