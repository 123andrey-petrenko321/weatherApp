const express = require('express')
const bodyParser = require('body-parser')
const config = require('config')
const exphbs = require('express-handlebars')
const { pool } = require('./db/dbConfig')
const bcrypt = require('bcrypt')
const session = require('express-session')
const flash = require('express-flash')
const passport = require('passport')
const fetch = require('node-fetch')
const path = require('path')
const request = require('request')
const app = express()


const initPassport = require('./passportConfig')
const { json } = require('body-parser')
initPassport(passport)

const hbs = exphbs.create({
  defaultLayout: 'main',
  extname: 'hbs'
})
app.use(express.static(path.join(__dirname, '/public')))
app.use(bodyParser.urlencoded({ extended: true }))
app.use(bodyParser.json())

app.use(
  session({
    secret: "secret",
    resave: false,
    saveUninitialized: false
  })
)
app.use(passport.initialize())
app.use(passport.session())
app.use(flash())

app.engine('hbs', hbs.engine)
app.set('view engine', 'hbs')
app.set('views', 'views')

app.get('/', (req, res) => {
  res.render('index')
})
app.get('/users/login', checkAuth, (req, res) => {
  res.render('login')
})
app.get('/users/register', checkAuth, (req, res) => {
  res.render('register')
})
app.get('/users/dashboard', checkNotAuth, (req, res) => {
  res.render('dashboard', {
    city: null,
    temp: null,
    feels_like: null,
    descr: null,
    icon: null,
    wind: null
  })
})
app.get('/users/logout', (req, res) => {
  req.logOut()
  req.flash("success_msg", "You have logged out ")
  res.redirect('/users/login')
})

app.get('/users/city/:city?', async(req,res)=>{
  let weatherList = []
  const url = `https://api.openweathermap.org/data/2.5/forecast?q=${req.params.city}&appid=${process.env.API_KEY}`
  let city = req.params.city
  try {
    await fetch(url)
      .then(res => res.json())
      .then(data => {
        if (data.cod == 200) {
         weatherList = data.list.map((timeframe) => {
            return ({
              temp: Math.round(timeframe.main.temp - 273),
              feels_like: Math.round(timeframe.main.feels_like - 273),
              descr: timeframe.weather[0].description,
              icon: timeframe.weather[0].icon,
              wind: timeframe.wind.speed,
              date:timeframe.dt_txt
            })
         })
        }
      })
    } catch (error) {
      res.render('favorites',{error:"Server Error"})
    }
  
  res.render('city',{weatherList,city})
})

app.get('/users/favorites', (req, res) => {

  pool.query(`
  SELECT * FROM cities`, (err, result) => {
    if (err) {
      res.render('favorites', { error: "something wrong" })
    }

    const getWeather = async () => {
      const weatherList = []
      for (let city of result.rows) {
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${city.name}&appid=${process.env.API_KEY}`
        try {
          await fetch(url)
            .then(res => res.json())
            .then(data => {
              if (data.cod == 200) {
                const weather = {
                  city: data.name,
                  temp: Math.round(data.main.temp - 273),
                  feels_like: Math.round(data.main.feels_like - 273),
                  descr: data.weather[0].description,
                  icon: data.weather[0].icon,
                  wind: data.wind.speed
                }
                weatherList.push(weather)
              }
            })
        } catch (error) {
          res.render('favorites',{error:"Server Error"})
        }
      }
      return weatherList
    }
    result = getWeather()
    result.then(weather=>{res.render('favorites',{weather})})
    
  })
})
app.post('/users/dashboard', async (req, res) => {
  const city = req.body.city
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${process.env.API_KEY}`

  try {
    await fetch(url)
      .then(res => res.json())
      .then(data => {
        if (data.cod == 200) {
          const weather = {
            city: data.name,
            temp: Math.round(data.main.temp - 273),
            feels_like: Math.round(data.main.feels_like - 273),
            descr: data.weather[0].description,
            icon: data.weather[0].icon,
            wind: data.wind.speed
          }
          res.render('dashboard', weather)
        }
      })
  } catch (error) {
    res.render('dashboard', {
      city: 'something wrong',
      temp: null,
      feels_like: null,
      descr: null,
      icon: null,
      wind: null
    })
  }
})
app.post('/users/cityCard', async (req, res) => {
  let { city } = req.body
  pool.query(
    `INSERT INTO cities (name)
         VALUES ($1)`, [city], (err, result) => {
    if (err) {
      res.render('dashboard', { error: "This city already added" })
    } else {
      res.render('dashboard', { message: "City added to favorites" })
    }
  }
  )
})

app.post('/users/register', async (req, res) => {
  let { name, email, password, password2 } = req.body;

  let errors = []
  if (!name || !email || !password || !password2) {
    errors.push({ message: "Please enter all fields" })
  }
  if (password.length < 6) {
    errors.push({ message: "Too shord password,must be min 6 chars" })
  }
  if (password != password2) {
    errors.push({ message: "Passwords do not match" })
  }
  if (errors.length > 0) {
    res.render('register', { errors })
  } else {
    let hashedPass = await bcrypt.hash(password, 10)

    pool.query(
      `SELECT * FROM users 
        WHERE email = $1`, [email], (err, results) => {
      if (err) {
        throw err
      }
      if (results.length > 0) {
        errors.push({ message: "Email already exist" })
        res.render('register', { errors })
      } else {
        pool.query(
          `INSERT INTO users (name,email,password)
           VALUES ($1, $2, $3)
           RETURNING id,password`, [name, email, hashedPass], (err, results) => {
          if (err) {
            throw err
          }
          req.flash('success_msg', "Register done,please login")
          res.redirect('/users/login')
        }
        )
      }
    }
    )
  }
})

app.post(
  '/users/login',
  passport.authenticate('local', {
    successRedirect: '/users/dashboard',
    failureRedirect: '/users/login',
    failureFlash: true
  })
)

function checkAuth(req, res, next) {
  if (req.isAuthenticated()) {
    return res.redirect('/users/dashboard')
  }
  next()
}

function checkNotAuth(req, res, next) {
  if (req.isAuthenticated()) {
    return next()
  }
  res.redirect('/users/login')
}

const PORT = process.env.PORT || config.server.port

app.listen(PORT, () => {
  console.log(`Example app listening at http://localhost:${PORT}`)
})