const CONFIG = {
  // Ссылка на развернутый веб-скрипт Google Таблицы:
  GOOGLE_SCRIPT_URL: "1https://script.google.com/macros/s/AKfycbxJoNsQeQgdDl9mkkQx1JzoEXspOWRZSrfL5u0ZikKmGHBpaykyi2ZiXmThJlJ-5vis/exec",

  // Ключ резервной отправки данных на почту через Web3Forms (срабатывает автоматически, если Google Таблица недоступна):
  WEB3FORMS_ACCESS_KEY: "76c26fd2-aa7d-48ad-9a63-16cf8458c507",

  BREAK_DURATION_SEC: 60, // 1 минута (60 сек)
  MIN_VIEW_TIME_MS: 1500, // 1,5 секунды (1500 мс) до разблокировки кнопки "Далее"

  // Группа 1 (папка images/group_1/) — основное расширение .jpg
  GROUP_A: [
    "Bed 1.jpg", "Bird 3.jpg", "Bloody knife 1.jpg", "Boxing 2.jpg",
    "Bubble 2.jpg", "Cotton swabs 2.jpg", "Depressed face 1.jpg", "Depressed pose 1.jpg",
    "Drink 1.jpg", "Fireman 1.jpg", "Fireworks 7.jpg", "Flowers 6.jpg",
    "Guitar 1.jpg", "Horse racing 1.jpg", "Lake 9.jpg", "Lamb 1.jpg",
    "Lion 1.jpg", "Miserable pose 3.jpg", "Motocross 1.jpg", "Parachuting 1.jpg",
    "Path 1.jpg", "Plane crash 4.jpg", "Prison 2.jpg", "Rock climbing 1.jpg",
    "Rollercoaster 3.jpg", "Shark 4.jpg", "Skier 1.jpg", "Sun 1.jpg",
    "Thunderstorm 7.jpg", "Timber 4.jpg"
  ],

  // Группа 2 (папка images/group_2/) — основное расширение .jpg
  GROUP_B: [
    "Acorns 2.jpg", "Bear 3.jpg", "Bee 1.jpg", "Billiards 1.jpg",
    "Candle 1.jpg", "Car race 2.jpg", "Cat 5.jpg", "Dessert 5.jpg",
    "Dock 1.jpg", "Dog 26.jpg", "Fire 9.jpg", "Gorrila 1.jpg",
    "Hang gliding 3.jpg", "Hangover 1.jpg", "Horse 1.jpg", "Moon 1.jpg",
    "Power lines 1.jpg", "Rooster 1.jpg", "Satellite 1.jpg", "Siblings 1.jpg",
    "Skijump 2.jpg", "Sky 1.jpg", "Socks 1.jpg", "Spider 2.jpg",
    "Stingray 2.jpg", "Sunflower 1.jpg", "Tornado 1.jpg", "Weapon 1.jpg",
    "Windmill 1.jpg", "Yarn 2.jpg"
  ]
};
